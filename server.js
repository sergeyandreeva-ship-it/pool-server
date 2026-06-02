const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const MS_TOKEN = process.env.MS_TOKEN;           // API-токен Мой склад
const MS_ORG_ID = process.env.MS_ORG_ID;         // ID вашей организации
const PORT = process.env.PORT || 3000;

if (!MS_TOKEN || !MS_ORG_ID) {
  console.error("❌ Не заданы переменные окружения MS_TOKEN и/или MS_ORG_ID");
  process.exit(1);
}

// Формируем текст описания заказа из данных чеклиста
function buildDescription(data) {
  const { answers, volume, selectedFilter, selectedUV, selectedHeating, notes } = data;

  const lines = [];

  if (volume) lines.push(`📊 Объём бассейна: ${parseFloat(volume).toFixed(1)} м³`);
  if (selectedFilter) lines.push(`⚙️ Фильтр: Песочный ⌀${selectedFilter.d} мм (${selectedFilter.label})`);
  if (selectedUV) lines.push(`☀️ УФ-установка: ${selectedUV.label} — ${selectedUV.w} Вт`);
  if (selectedHeating) lines.push(`🔥 Нагрев: ${selectedHeating}`);

  lines.push("");

  const sectionNames = {
    0: "📐 Размеры и тип бассейна",
    1: "⚙️ Система фильтрации",
    7: "🌊 Система противотока",
    2: "🔥 Подогрев воды",
    3: "💡 Освещение",
    4: "☀️ УФ-установка",
    5: "🧪 Станция дозации",
    6: "🏊 Покрытие бассейна",
  };

  // Группируем ответы по секциям
  const bySec = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (!v) continue;
    const [sid] = k.split("-");
    if (!bySec[sid]) bySec[sid] = [];
    bySec[sid].push(`  • ${k.split("-").slice(1).join("-")}: ${v}`);
  }

  for (const [sid, name] of Object.entries(sectionNames)) {
    if (bySec[sid] && bySec[sid].length > 0) {
      lines.push(name);
      lines.push(...bySec[sid]);
      if (notes && notes[sid]) lines.push(`  📝 ${notes[sid]}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// POST /create-order — создать заказ покупателя в Мой склад
app.post("/create-order", async (req, res) => {
  try {
    const data = req.body;

    // Имя клиента из чеклиста (если передали) или дефолт
    const clientName = data.clientName || "Клиент (бассейн)";

    // Описание заказа
    const description = buildDescription(data);

    // Сначала ищем или создаём контрагента
    let counterpartyHref = null;

    // Поиск существующего контрагента по имени
    const searchResp = await fetch(
      `https://api.moysklad.ru/api/remap/1.2/entity/counterparty?filter=name=${encodeURIComponent(clientName)}`,
      {
        headers: {
          Authorization: `Bearer ${MS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    const searchData = await searchResp.json();

    if (searchData.rows && searchData.rows.length > 0) {
      // Контрагент найден
      counterpartyHref = searchData.rows[0].meta.href;
    } else {
      // Создаём нового контрагента
      const cpResp = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/counterparty", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: clientName,
          companyType: "individual",
        }),
      });
      const cpData = await cpResp.json();
      if (!cpData.meta) {
        console.error("Ошибка создания контрагента:", cpData);
        return res.status(500).json({ error: "Не удалось создать контрагента", detail: cpData });
      }
      counterpartyHref = cpData.meta.href;
    }

    // Создаём заказ покупателя
    const orderBody = {
      organization: {
        meta: {
          href: `https://api.moysklad.ru/api/remap/1.2/entity/organization/${MS_ORG_ID}`,
          type: "organization",
          mediaType: "application/json",
        },
      },
      agent: {
        meta: {
          href: counterpartyHref,
          type: "counterparty",
          mediaType: "application/json",
        },
      },
      description: description,
      // Название заказа
      name: `Бассейн — ${clientName} — ${new Date().toLocaleDateString("ru-RU")}`,
    };

    const orderResp = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/customerorder", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderBody),
    });

    const orderData = await orderResp.json();

    if (!orderData.meta) {
      console.error("Ошибка создания заказа:", orderData);
      return res.status(500).json({ error: "Не удалось создать заказ", detail: orderData });
    }

    console.log(`✅ Создан заказ: ${orderData.name} (${orderData.id})`);

    return res.json({
      success: true,
      orderId: orderData.id,
      orderName: orderData.name,
      orderUrl: `https://online.moysklad.ru/app/#customerorder/edit?id=${orderData.id}`,
    });

  } catch (err) {
    console.error("Ошибка сервера:", err);
    return res.status(500).json({ error: "Внутренняя ошибка сервера", detail: err.message });
  }
});

// Healthcheck
app.get("/", (req, res) => res.json({ status: "ok", service: "pool-checklist → Мой склад" }));

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);

  // Самопинг каждые 10 минут — чтобы Render не засыпал
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(async () => {
    try {
      await fetch(`${SELF_URL}/`);
      console.log("✅ Самопинг — сервер активен");
    } catch (e) {
      console.log("⚠️ Самопинг не удался:", e.message);
    }
  }, 10 * 60 * 1000);
});
