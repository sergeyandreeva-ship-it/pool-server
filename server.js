const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const MS_LOGIN    = process.env.MS_LOGIN;
const MS_PASSWORD = process.env.MS_PASSWORD;
const MS_ORG_ID   = process.env.MS_ORG_ID;
const TG_TOKEN    = process.env.TG_TOKEN;
const TG_CHAT_ID  = process.env.TG_CHAT_ID;
const PORT        = process.env.PORT || 3000;

if (!MS_LOGIN || !MS_PASSWORD || !MS_ORG_ID) {
  console.error("No env vars"); process.exit(1);
}

const AUTH    = "Basic " + Buffer.from(MS_LOGIN + ":" + MS_PASSWORD).toString("base64");
const HEADERS = { Authorization: AUTH, "Content-Type": "application/json" };

const LABELS = {
  "0-type":"Тип бассейна","0-material":"Материал чаши","0-form":"Форма",
  "0-length":"Длина (м)","0-width":"Ширина (м)","0-depth_type":"Глубина",
  "0-depth_single":"Глубина (м)","0-depth_shallow":"Мелкая часть (м)","0-depth_deep":"Глубокая часть (м)",
  "0-location":"Расположение",
  "1-pump":"Насос","1-backwash":"Промывка фильтра",
  "7-countercurrent":"Противоток","7-cc_power":"Мощность противотока","7-cc_control":"Управление противотоком",
  "2-heating":"Подогрев","2-heating_type":"Тип нагрева","2-hp_voltage":"Напряжение ТН",
  "2-eh_voltage":"Напряжение ЭН","2-target_temp":"Желаемая температура воды (C)","2-boiler":"Есть котёл",
  "3-lighting":"Освещение","3-lighting_type":"Тип освещения","3-lighting_count":"Кол-во прожекторов",
  "3-lighting_perimeter":"Подсветка периметра","3-lighting_control":"Управление освещением",
  "4-uv":"УФ-установка","4-uv_kids":"Дети/аллергики",
  "5-dosing":"Станция дозации","5-dosing_type":"Тип дозации","5-dosing_mode":"Режим химии",
  "5-dosing_freq":"Частота обслуживания",
  "6-cover":"Покрытие","6-cover_type":"Тип покрытия","6-cover_mode":"Управление покрытием",
  "6-cover_color":"Цвет покрытия","6-cover_leaves":"Защита от листьев"
};

const SECS = {
  "0":"РАЗМЕРЫ И ТИП БАССЕЙНА","1":"СИСТЕМА ФИЛЬТРАЦИИ","7":"СИСТЕМА ПРОТИВОТОКА",
  "2":"ПОДОГРЕВ ВОДЫ","3":"ОСВЕЩЕНИЕ","4":"УФ-УСТАНОВКА",
  "5":"СТАНЦИЯ ДОЗАЦИИ","6":"ПОКРЫТИЕ БАССЕЙНА"
};

function buildDesc(data) {
  const { answers, volume, selectedFilter, selectedUV, selectedHeating, notes } = data;
  const L = [];
  if (volume)          L.push("ОБЪЁМ: " + parseFloat(volume).toFixed(1) + " м3");
  if (selectedFilter)  L.push("ФИЛЬТР: Песочный d" + selectedFilter.d + " мм (" + selectedFilter.label + ")");
  if (selectedUV)      L.push("УФ-ЛАМПА: " + selectedUV.label + " - " + selectedUV.w + " Вт");
  if (selectedHeating) L.push("НАГРЕВ: " + selectedHeating);
  L.push("");

  const bySec = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (!v) continue;
    const sid = k.split("-")[0];
    if (!bySec[sid]) bySec[sid] = [];
    bySec[sid].push("  " + (LABELS[k] || k.split("-").slice(1).join("-")) + ": " + v);
  }
  for (const [sid, sname] of Object.entries(SECS)) {
    if (bySec[sid] && bySec[sid].length) {
      L.push(sname);
      L.push(...bySec[sid]);
      if (notes && notes[sid]) L.push("  Заметка: " + notes[sid]);
      L.push("");
    }
  }
  return L.join("\n");
}

async function sendTG(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch("https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) { console.error("TG:", e.message); }
}

function normPhone(p) { return p ? p.replace(/\D/g, "") : ""; }

async function findByPhone(phone) {
  const n = normPhone(phone);
  if (!n || n.length < 7) return null;
  const r = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/counterparty?limit=100", { headers: HEADERS });
  const d = await r.json();
  if (!d.rows) return null;
  for (const cp of d.rows) {
    const p2 = normPhone(cp.phone || "");
    if (p2 && p2.endsWith(n.slice(-7))) return { href: cp.meta.href, name: cp.name };
  }
  return null;
}

app.post("/create-order", async (req, res) => {
  try {
    const data       = req.body;
    const clientName = data.clientName || "Клиент";
    const clientPhone = data.clientPhone || "";
    const description = buildDesc(data);

    let href = null, cpName = clientName, isNew = true;

    if (clientPhone) {
      const f = await findByPhone(clientPhone);
      if (f) { href = f.href; cpName = f.name; isNew = false; }
    }
    if (!href) {
      const sr = await fetch(
        "https://api.moysklad.ru/api/remap/1.2/entity/counterparty?filter=name=" + encodeURIComponent(clientName),
        { headers: HEADERS }
      );
      const sd = await sr.json();
      if (sd.rows && sd.rows.length) { href = sd.rows[0].meta.href; cpName = sd.rows[0].name; isNew = false; }
    }
    if (!href) {
      const cb = { name: clientName, companyType: "individual" };
      if (clientPhone) cb.phone = clientPhone;
      const cr = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/counterparty",
        { method: "POST", headers: HEADERS, body: JSON.stringify(cb) });
      const cd = await cr.json();
      if (!cd.meta) return res.status(500).json({ error: "Ошибка контрагента", detail: cd });
      href = cd.meta.href;
    }

    const oName = cpName + " - Бассейн - " + new Date().toLocaleDateString("ru-RU");
    const ob = {
      organization: { meta: { href: "https://api.moysklad.ru/api/remap/1.2/entity/organization/" + MS_ORG_ID, type: "organization", mediaType: "application/json" } },
      agent:        { meta: { href, type: "counterparty", mediaType: "application/json" } },
      name: oName,
      description,
    };
    const or = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/customerorder",
      { method: "POST", headers: HEADERS, body: JSON.stringify(ob) });
    const od = await or.json();
    if (!od.meta) return res.status(500).json({ error: "Ошибка заказа", detail: od });

    const url = "https://online.moysklad.ru/app/#customerorder/edit?id=" + od.id;
    const vol = data.volume ? parseFloat(data.volume).toFixed(1) + " м3" : "—";

    const tg = ["<b>Новый заказ — Бассейн</b>", "",
      "<b>Клиент:</b> " + cpName + (isNew ? " (новый)" : " (сущ.)")];
    if (clientPhone)       tg.push("<b>Тел:</b> " + clientPhone);
    tg.push("<b>Объём:</b> " + vol);
    if (data.selectedFilter)  tg.push("<b>Фильтр:</b> d" + data.selectedFilter.d + " мм");
    if (data.selectedHeating) tg.push("<b>Нагрев:</b> " + data.selectedHeating);
    if (data.selectedUV)      tg.push("<b>УФ:</b> " + data.selectedUV.label + " " + data.selectedUV.w + " Вт");
    tg.push("", "<b>Заказ:</b> <a href=\"" + url + "\">" + od.name + "</a>");
    tg.push(new Date().toLocaleString("ru-RU", { timeZone: "Asia/Irkutsk" }) + " (Иркутск)");
    await sendTG(tg.join("\n"));

    return res.json({ success: true, orderId: od.id, orderName: od.name, orderUrl: url });
  } catch (err) {
    return res.status(500).json({ error: "Ошибка сервера", detail: err.message });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => {
  console.log("Server on port " + PORT);
  const S = process.env.RENDER_EXTERNAL_URL || "http://localhost:" + PORT;
  setInterval(async () => { try { await fetch(S + "/"); } catch (e) {} }, 10 * 60 * 1000);
});
