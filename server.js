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
  console.error("Не заданы переменные");
  process.exit(1);
}

const AUTH    = "Basic " + Buffer.from(MS_LOGIN + ":" + MS_PASSWORD).toString("base64");
const HEADERS = { Authorization: AUTH, "Content-Type": "application/json" };

async function sendTelegram(text) {
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
    const data = req.body, clientName = data.clientName || "Клиент", clientPhone = data.clientPhone || "";
    let href = null, cpName = clientName, isNew = true;

    if (clientPhone) { const f = await findByPhone(clientPhone); if (f) { href=f.href; cpName=f.name; isNew=false; } }
    if (!href) {
      const sr = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/counterparty?filter=name="+encodeURIComponent(clientName), { headers: HEADERS });
      const sd = await sr.json();
      if (sd.rows && sd.rows.length) { href=sd.rows[0].meta.href; cpName=sd.rows[0].name; isNew=false; }
    }
    if (!href) {
      const cb = { name: clientName, companyType: "individual" };
      if (clientPhone) cb.phone = clientPhone;
      const cr = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/counterparty", { method:"POST", headers:HEADERS, body:JSON.stringify(cb) });
      const cd = await cr.json();
      if (!cd.meta) return res.status(500).json({ error: "Ошибка контрагента", detail: cd });
      href = cd.meta.href;
    }

    const vol = data.volume ? parseFloat(data.volume).toFixed(1) : "?";
    const oName = "Бассейн — " + cpName + " — " + new Date().toLocaleDateString("ru-RU");
    const ob = {
      organization: { meta: { href: "https://api.moysklad.ru/api/remap/1.2/entity/organization/" + MS_ORG_ID, type: "organization", mediaType: "application/json" } },
      agent: { meta: { href, type: "counterparty", mediaType: "application/json" } },
      name: oName,
      description: "Объём: "+vol+" м3" + (clientPhone?"\nТел: "+clientPhone:"") +
        "\nФильтр: "+(data.selectedFilter?"d"+data.selectedFilter.d+" мм ("+data.selectedFilter.label+")":"—") +
        "\nНагрев: "+(data.selectedHeating||"—") +
        "\nУФ: "+(data.selectedUV?data.selectedUV.label+" "+data.selectedUV.w+" Вт":"—"),
    };
    const or = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/customerorder", { method:"POST", headers:HEADERS, body:JSON.stringify(ob) });
    const od = await or.json();
    if (!od.meta) return res.status(500).json({ error: "Ошибка заказа", detail: od });

    const url = "https://online.moysklad.ru/app/#customerorder/edit?id=" + od.id;
    const tgLines = [
      "<b>Новый заказ — Бассейн</b>","",
      "<b>Клиент:</b> "+cpName+(isNew?" (новый)":" (сущ.)"),
    ];
    if (clientPhone) tgLines.push("<b>Тел:</b> "+clientPhone);
    tgLines.push("<b>Объём:</b> "+vol+" м3");
    if (data.selectedFilter) tgLines.push("<b>Фильтр:</b> d"+data.selectedFilter.d+" мм");
    if (data.selectedHeating) tgLines.push("<b>Нагрев:</b> "+data.selectedHeating);
    tgLines.push("","<b>Заказ:</b> <a href=\""+url+"\">"+od.name+"</a>");
    tgLines.push(new Date().toLocaleString("ru-RU",{timeZone:"Asia/Irkutsk"})+" (Иркутск)");
    await sendTelegram(tgLines.join("\n"));

    return res.json({ success:true, orderId:od.id, orderName:od.name, orderUrl:url });
  } catch(err) { return res.status(500).json({ error:"Ошибка сервера", detail:err.message }); }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => {
  console.log("Сервер на порту " + PORT);
  const S = process.env.RENDER_EXTERNAL_URL || "http://localhost:" + PORT;
  setInterval(async () => { try { await fetch(S+"/"); } catch(e) {} }, 10*60*1000);
});
