import { useState, useMemo } from "react";

// === Расчёт песочного фильтра ===
const FILTER_DIAMETERS = [350, 400, 500, 600, 650, 750, 900];
function calcFilter(volumeM3, hours) {
  if (!volumeM3 || volumeM3 <= 0) return null;
  const needed = volumeM3 / hours;
  for (const d of FILTER_DIAMETERS) {
    const perf = Math.PI * Math.pow(d / 1000 / 2, 2) * 25;
    if (perf >= needed) return { d, perf: perf.toFixed(1), needed: needed.toFixed(1) };
  }
  return { d: 900, perf: "макс", needed: needed.toFixed(1), oversize: true };
}

// === Расчёт УФ-установки ===
function calcUV(volumeM3) {
  if (!volumeM3) return null;
  const flowLh = volumeM3 * 1000 / 4;
  const wRaw = flowLh / 10;
  return [
    { label: "Базовый",  w: Math.ceil(wRaw * 0.7 / 5) * 5, desc: "Оборотность 6 ч — эконом" },
    { label: "Стандарт", w: Math.ceil(wRaw       / 5) * 5, desc: "Оборотность 4 ч — рекомендуется" },
    { label: "Профи",    w: Math.ceil(wRaw * 1.5  / 5) * 5, desc: "Оборотность 2.5 ч — максимальная защита" },
  ];
}

// === Расчёт подогрева (Иркутск) ===
// Т воды на входе = 8°C (скважина/водопровод Иркутск)
// Перепад день/ночь до 28°С днём и 0°С ночью → жёсткие условия
// Потери тепла открытого бассейна: 200 Вт/м² (Иркутск, без накрытия)
// Время первичного нагрева: 24 ч
// Тепловой насос COP = 3.5 (консервативно, +10°С нар. воздух)
// Запас для ТН: ×1.3, для ЭН: ×1.4 (ночные потери Иркутска)
function calcHeating(volumeM3, targetTemp, L, W) {
  if (!volumeM3 || !targetTemp || !L || !W) return null;
  const deltaT = targetTemp - 8;
  if (deltaT <= 0) return null;
  const area = L * W;
  const qHeat = (volumeM3 * 1000 * 4186 * deltaT) / (24 * 3600) / 1000; // кВт на нагрев
  const qLoss = (area * 200) / 1000; // кВт потери
  const qTotal = qHeat + qLoss;
  const cop = 3.5;
  return {
    qHeat:  qHeat.toFixed(1),
    qLoss:  qLoss.toFixed(1),
    qTotal: qTotal.toFixed(1),
    hpMin:  Math.ceil(qTotal / cop),
    hpRec:  Math.ceil(qTotal / cop * 1.3),
    ehMin:  Math.ceil(qTotal),
    ehRec:  Math.ceil(qTotal * 1.4),
  };
}

const sections = [
  {
    id: 0, icon: "📐", title: "Размеры и тип бассейна", color: "#06B6D4",
    questions: [
      { key: "type",          text: "Тип бассейна:",         options: ["Скиммерный", "Переливной"] },
      { key: "material",      text: "Материал чаши:",        options: ["Бетон (монолит)", "Полипропилен", "Стекловолокно (композит)", "Деревянный", "Готовый модуль"] },
      { key: "form",          text: "Форма бассейна:",       options: ["Прямоугольник", "Овал / Круг", "Свободная форма", "Другое"] },
      { key: "length",        text: "Длина (м):",            type: "input", placeholder: "Например: 8" },
      { key: "width",         text: "Ширина (м):",           type: "input", placeholder: "Например: 4" },
      { key: "depth_type",    text: "Глубина:",              options: ["Одна глубина", "Переменная глубина"] },
      { key: "depth_single",  text: "Глубина (м):",          type: "input", placeholder: "Например: 1.5", showIf: { key: "depth_type", value: "Одна глубина" } },
      { key: "depth_shallow", text: "Мелкая часть (м):",     type: "input", placeholder: "Например: 1.2", showIf: { key: "depth_type", value: "Переменная глубина" } },
      { key: "depth_deep",    text: "Глубокая часть (м):",   type: "input", placeholder: "Например: 1.8", showIf: { key: "depth_type", value: "Переменная глубина" } },
      { key: "location",      text: "Крытый или открытый?",  options: ["Открытый", "Крытый", "Комбинированный"] },
    ],
  },
  {
    id: 1, icon: "⚙️", title: "Система фильтрации", color: "#0EA5E9",
    hasFilterCalc: true,
    questions: [
      { key: "pump",     text: "Насос:",    options: ["Однофазный (220В)", "Трёхфазный (380В)"] },
      { key: "backwash", text: "Промывка фильтра:", options: ["Ручная", "Автоматическая", "Сервисное обслуживание"] },
    ],
  },
  {
    id: 7, icon: "🌊", title: "Система противотока", color: "#38BDF8",
    questions: [
      { key: "countercurrent", text: "Нужна ли система противотока?", options: ["Да", "Нет", "Уточнить"] },
      { key: "cc_power",   text: "Мощность:",   options: ["1 форсунка (до 50 м³/ч)", "2 форсунки", "Профессиональный (3+)"], showIf: { key: "countercurrent", value: "Да" } },
      { key: "cc_control", text: "Управление:", options: ["Ручное", "Пульт", "Умный дом"],                                  showIf: { key: "countercurrent", value: "Да" } },
    ],
  },
  {
    id: 2, icon: "🔥", title: "Подогрев воды", color: "#F97316",
    hasHeatingCalc: true,
    questions: [
      { key: "heating",         text: "Нужен ли подогрев?",   options: ["Да", "Нет"] },
      { key: "heating_type",    text: "Тип нагрева:",         options: ["Тепловой насос", "Электронагреватель", "Теплообменник", "Альтернативный источник (солнце/котёл)"], showIf: { key: "heating", value: "Да" } },
      { key: "hp_voltage",      text: "Напряжение питания:",  options: ["220 В", "380 В"], showIf: { key: "heating_type", value: "Тепловой насос" } },
      { key: "eh_voltage",      text: "Напряжение питания:",  options: ["220 В", "380 В"], showIf: { key: "heating_type", value: "Электронагреватель" } },
      { key: "target_temp",     text: "Желаемая температура воды (°C):", type: "input", placeholder: "Например: 28", showIf: { key: "heating", value: "Да" } },
      { key: "boiler",          text: "Есть котёл или тепловая система?", options: ["Да", "Нет"], showIf: { key: "heating", value: "Да" } },
    ],
  },
  {
    id: 3, icon: "💡", title: "Освещение", color: "#EAB308",
    questions: [
      { key: "lighting",           text: "Нужно ли освещение?",           options: ["Да", "Нет"] },
      { key: "lighting_type",      text: "Тип освещения:",                options: ["LED (белый)", "LED (RGB/цветной)"],      showIf: { key: "lighting", value: "Да" } },
      { key: "lighting_count",     text: "Количество прожекторов:",       type: "input", placeholder: "Например: 2",          showIf: { key: "lighting", value: "Да" } },
      { key: "lighting_perimeter", text: "Подсветка лестницы/периметра?", options: ["Да", "Нет"],                            showIf: { key: "lighting", value: "Да" } },
      { key: "lighting_control",   text: "Управление:",                   options: ["Ручное", "Автоматическое", "Умный дом"], showIf: { key: "lighting", value: "Да" } },
    ],
  },
  {
    id: 4, icon: "☀️", title: "УФ-установка", color: "#8B5CF6",
    hasUVCalc: true,
    questions: [
      { key: "uv",      text: "Нужна ли УФ-установка?",   options: ["Да", "Нет", "Уточнить"] },
      { key: "uv_kids", text: "Есть ли дети или аллергики?", options: ["Да", "Нет"] },
    ],
  },
  {
    id: 5, icon: "🧪", title: "Станция дозации", color: "#10B981",
    questions: [
      { key: "dosing",      text: "Нужна ли автоматическая станция?",      options: ["Да", "Нет", "Уточнить"] },
      { key: "dosing_type", text: "Тип дозации:",                          options: ["pH + хлор", "pH + бром", "Соляной хлоргенератор", "Озонирование"], showIf: { key: "dosing", value: "Да" } },
      { key: "dosing_mode", text: "Режим химии:",                          options: ["Ручная", "Полуавтомат", "Полный автомат"] },
      { key: "dosing_freq", text: "Как часто клиент готов обслуживать?",   options: ["Ежедневно", "1-2 раза в неделю", "Минимально"] },
    ],
  },
  {
    id: 6, icon: "🏊", title: "Покрытие бассейна", color: "#EC4899",
    questions: [
      { key: "cover",        text: "Нужно ли покрытие?",         options: ["Да", "Нет"] },
      { key: "cover_type",   text: "Тип покрытия:",              options: ["Плавающее (пузырьковое)", "Рулонное (автоматическое)", "Жёсткое (декшинг)", "Безопасное покрытие"], showIf: { key: "cover", value: "Да" } },
      { key: "cover_mode",   text: "Управление:",                options: ["Автоматическое", "Ручное"],                                                                          showIf: { key: "cover", value: "Да" } },
      { key: "cover_color",  text: "Цвет покрытия:",             options: ["Синий", "Серый", "Прозрачный", "Другой"],                                                            showIf: { key: "cover", value: "Да" } },
      { key: "cover_leaves", text: "Защита от листьев/мусора?",  options: ["Да", "Нет"] },
    ],
  },
];

// ⬇️ Вставь URL сервера Railway после деплоя
const SERVER_URL = "https://pool-server-sjgn.onrender.com";

export default function PoolChecklist() {
  const [answers, setAnswers] = useState({});
  const [expanded, setExpanded] = useState({ 0: true });
  const [notes, setNotes] = useState({});
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [selectedUV, setSelectedUV] = useState(null);
  const [selectedHeating, setSelectedHeating] = useState(null); // { type: "hp"|"eh", label }
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const getAnswer = (sid, key) => answers[`${sid}-${key}`];
  const setAnswer = (sid, key, val) => setAnswers((p) => ({ ...p, [`${sid}-${key}`]: val }));
  const isVisible = (section, q) => !q.showIf || getAnswer(section.id, q.showIf.key) === q.showIf.value;
  const toggleSection = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const volume = useMemo(() => {
    const L = parseFloat(getAnswer(0, "length"));
    const W = parseFloat(getAnswer(0, "width"));
    const dt = getAnswer(0, "depth_type");
    let D = 0;
    if (dt === "Одна глубина") D = parseFloat(getAnswer(0, "depth_single"));
    else if (dt === "Переменная глубина") D = (parseFloat(getAnswer(0, "depth_shallow")) + parseFloat(getAnswer(0, "depth_deep"))) / 2;
    return (L > 0 && W > 0 && D > 0) ? L * W * D : null;
  }, [answers]);

  const dims = useMemo(() => ({
    L: parseFloat(getAnswer(0, "length")) || null,
    W: parseFloat(getAnswer(0, "width"))  || null,
  }), [answers]);

  const filterOptions = useMemo(() => volume ? [
    { label: "Оборотность 4 ч",  hours: 4,  ...calcFilter(volume, 4) },
    { label: "Оборотность 6 ч",  hours: 6,  ...calcFilter(volume, 6) },
    { label: "Оборотность 12 ч", hours: 12, ...calcFilter(volume, 12) },
  ] : null, [volume]);

  const uvOptions = useMemo(() => calcUV(volume), [volume]);

  const heatingCalc = useMemo(() => {
    const temp = parseFloat(getAnswer(2, "target_temp"));
    return calcHeating(volume, temp, dims.L, dims.W);
  }, [answers, volume, dims]);

  const heatingType = getAnswer(2, "heating_type");
  const showHPCalc = heatingType === "Тепловой насос" && getAnswer(2, "heating") === "Да";
  const showEHCalc = heatingType === "Электронагреватель" && getAnswer(2, "heating") === "Да";

  const answered = Object.keys(answers).filter((k) => answers[k]).length;

  const exportText = () => {
    let text = "ЧЕКЛИСТ: ПЕРВИЧНОЕ ОБРАЩЕНИЕ — БАССЕЙН\n" + "=".repeat(45) + "\n\n";
    if (volume) text += `📊 Объём бассейна: ${volume.toFixed(1)} м³\n`;
    if (selectedFilter) text += `⚙️ Фильтр: ⌀${selectedFilter.d} мм (${selectedFilter.label})\n`;
    if (selectedUV) text += `☀️ УФ: ${selectedUV.label} — ${selectedUV.w} Вт\n`;
    if (selectedHeating) text += `🔥 Нагрев: ${selectedHeating}\n`;
    text += "\n";
    sections.forEach((s) => {
      text += `${s.icon} ${s.title.toUpperCase()}\n` + "-".repeat(30) + "\n";
      s.questions.forEach((q) => {
        if (!isVisible(s, q)) return;
        text += `• ${q.text}\n  → ${getAnswer(s.id, q.key) || "—"}\n`;
      });
      if (notes[s.id]) text += `📝 ${notes[s.id]}\n`;
      text += "\n";
    });
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "checklist-bassein.txt"; a.click();
  };

  const sendToMS = async () => {
    if (!clientName.trim()) { alert("Введите имя клиента"); return; }
    if (SERVER_URL === "ВСТАВЬ_URL_СЕРВЕРА") { alert("Вставь URL сервера в код (константа SERVER_URL)"); return; }
    setSending(true);
    setSendResult(null);
    try {
      const resp = await fetch(`${SERVER_URL}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, volume, selectedFilter, selectedUV, selectedHeating, notes, clientName: clientName.trim() + (clientPhone ? ` (${clientPhone})` : "") }),
      });
      const data = await resp.json();
      if (data.success) setSendResult({ success: true, orderName: data.orderName, orderUrl: data.orderUrl });
      else setSendResult({ success: false, error: data.error || "Неизвестная ошибка" });
    } catch (e) {
      setSendResult({ success: false, error: "Нет связи с сервером: " + e.message });
    } finally {
      setSending(false);
    }
  };

  const C = "#0f172a", B = "#334155";

  const CalcCard = ({ selected, onClick, title, subtitle, badge, color, warn }) => (
    <button onClick={onClick} style={{ background: selected ? color + "18" : C, border: `1.5px solid ${selected ? color : B}`, borderRadius: 12, padding: "11px 15px", cursor: "pointer", textAlign: "left", transition: "all 0.2s", width: "100%", animation: "popIn 0.3s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <span style={{ color: selected ? color : "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{selected ? "✓ " : ""}{title}</span>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{subtitle}{warn && <span style={{ color: "#F97316" }}> ⚠ нестандарт</span>}</div>
        </div>
        <div style={{ background: selected ? color : "#334155", color: selected ? "#fff" : "#64748b", borderRadius: 8, padding: "4px 10px", fontSize: 13, fontWeight: 700, flexShrink: 0, marginLeft: 10, whiteSpace: "nowrap" }}>{badge}</div>
      </div>
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%)", fontFamily: "'Segoe UI',sans-serif", padding: "24px 16px", color: "#e2e8f0" }}>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes popIn  { from{opacity:0;transform:scale(0.95)}      to{opacity:1;transform:scale(1)} }
        input::placeholder{color:#475569} input:focus{outline:none}
      `}</style>

      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 44, marginBottom: 6 }}>🏊</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", margin: 0, letterSpacing: "-0.5px" }}>Чеклист — Первичное обращение</h1>
        <p style={{ color: "#94a3b8", marginTop: 4, fontSize: 13 }}>Иркутск · Строительство и оснащение бассейна</p>
        {volume && <div style={{ display: "inline-block", marginTop: 10, background: "#06B6D422", border: "1px solid #06B6D455", borderRadius: 10, padding: "5px 16px", fontSize: 14, color: "#06B6D4", fontWeight: 600 }}>📊 Объём: {volume.toFixed(1)} м³</div>}
        <div style={{ maxWidth: 400, margin: "14px auto 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginBottom: 5 }}>
            <span>Заполнено</span><span style={{ color: "#0EA5E9", fontWeight: 700 }}>{answered} вопросов</span>
          </div>
          <div style={{ background: "#0f172a", borderRadius: 99, height: 5, border: "1px solid #334155" }}>
            <div style={{ height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#06B6D4,#8B5CF6)", width: `${Math.min(100, answered * 2.5)}%`, transition: "width 0.4s ease" }} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>
        {sections.map((section) => {
          const isOpen = expanded[section.id];
          const visibleQs = section.questions.filter((q) => isVisible(section, q));
          const sectionAnswered = visibleQs.filter((q) => getAnswer(section.id, q.key)).length;

          return (
            <div key={section.id} style={{ background: "#1e293b", border: `1px solid ${isOpen ? section.color + "55" : B}`, borderRadius: 16, overflow: "hidden", transition: "border-color 0.3s" }}>
              <button onClick={() => toggleSection(section.id)} style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: section.color + "22", border: `1.5px solid ${section.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>{section.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>{section.title}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                    {sectionAnswered} из {visibleQs.length} заполнено
                    {section.hasFilterCalc && selectedFilter && <span style={{ color: section.color, marginLeft: 8 }}>· ⌀{selectedFilter.d} мм ✓</span>}
                    {section.hasUVCalc && selectedUV && <span style={{ color: section.color, marginLeft: 8 }}>· {selectedUV.w} Вт ✓</span>}
                    {section.hasHeatingCalc && selectedHeating && <span style={{ color: section.color, marginLeft: 8 }}>· выбран ✓</span>}
                  </div>
                </div>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: "#334155", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13, transform: isOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.3s" }}>▾</div>
              </button>

              {isOpen && (
                <div style={{ padding: "0 18px 18px", display: "flex", flexDirection: "column", gap: 14 }}>

                  {/* === Фильтр === */}
                  {section.hasFilterCalc && (
                    <div>
                      <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500, marginBottom: 8 }}>Подбор песочного фильтра:</div>
                      {!volume
                        ? <div style={{ background: C, border: `1px dashed ${B}`, borderRadius: 12, padding: "13px 15px", fontSize: 13, color: "#475569", textAlign: "center" }}>← Введите размеры бассейна для расчёта</div>
                        : <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            {filterOptions.map((opt) => (
                              <CalcCard key={opt.hours} color={section.color}
                                selected={selectedFilter?.hours === opt.hours}
                                onClick={() => setSelectedFilter(selectedFilter?.hours === opt.hours ? null : opt)}
                                title={opt.label}
                                subtitle={`Нужно ${opt.needed} м³/ч → фильтр ⌀${opt.d} мм (~${opt.perf} м³/ч)`}
                                badge={`⌀${opt.d} мм`} warn={opt.oversize} />
                            ))}
                          </div>
                      }
                    </div>
                  )}

                  {/* === УФ === */}
                  {section.hasUVCalc && getAnswer(4, "uv") === "Да" && (
                    <div>
                      <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500, marginBottom: 8 }}>Подбор мощности УФ-лампы:</div>
                      {!volume
                        ? <div style={{ background: C, border: `1px dashed ${B}`, borderRadius: 12, padding: "13px 15px", fontSize: 13, color: "#475569", textAlign: "center" }}>← Введите размеры бассейна для расчёта</div>
                        : <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            {uvOptions.map((opt) => (
                              <CalcCard key={opt.label} color={section.color}
                                selected={selectedUV?.label === opt.label}
                                onClick={() => setSelectedUV(selectedUV?.label === opt.label ? null : opt)}
                                title={opt.label} subtitle={`${opt.desc} · ${volume.toFixed(0)} м³`} badge={`${opt.w} Вт`} />
                            ))}
                          </div>
                      }
                    </div>
                  )}

                  {/* === Тепловой насос калькулятор === */}
                  {section.hasHeatingCalc && showHPCalc && (
                    <div style={{ animation: "fadeIn 0.2s ease" }}>
                      <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500, marginBottom: 8 }}>
                        Подбор теплового насоса <span style={{ color: "#F9731699", fontSize: 11 }}>(Иркутск, вода 8°C, потери 200 Вт/м²)</span>:
                      </div>
                      {!heatingCalc
                        ? <div style={{ background: C, border: `1px dashed ${B}`, borderRadius: 12, padding: "13px 15px", fontSize: 13, color: "#475569", textAlign: "center" }}>← Введите размеры бассейна и желаемую температуру</div>
                        : <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#64748b" }}>
                              Нагрев воды: {heatingCalc.qHeat} кВт · Потери тепла: {heatingCalc.qLoss} кВт · Итого: {heatingCalc.qTotal} кВт
                            </div>
                            <CalcCard color={section.color}
                              selected={selectedHeating === `ТН минимум ${heatingCalc.hpMin} кВт`}
                              onClick={() => setSelectedHeating(selectedHeating === `ТН минимум ${heatingCalc.hpMin} кВт` ? null : `ТН минимум ${heatingCalc.hpMin} кВт`)}
                              title="Минимум" subtitle="Работает в штатном режиме, без запаса" badge={`${heatingCalc.hpMin} кВт`} />
                            <CalcCard color={section.color}
                              selected={selectedHeating === `ТН рекомендовано ${heatingCalc.hpRec} кВт`}
                              onClick={() => setSelectedHeating(selectedHeating === `ТН рекомендовано ${heatingCalc.hpRec} кВт` ? null : `ТН рекомендовано ${heatingCalc.hpRec} кВт`)}
                              title="Рекомендовано ★" subtitle="Запас ×1.3 на ночные потери Иркутска (перепад до 28°С)" badge={`${heatingCalc.hpRec} кВт`} />
                          </div>
                      }
                    </div>
                  )}

                  {/* === Электронагреватель калькулятор === */}
                  {section.hasHeatingCalc && showEHCalc && (
                    <div style={{ animation: "fadeIn 0.2s ease" }}>
                      <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500, marginBottom: 8 }}>
                        Подбор электронагревателя <span style={{ color: "#F9731699", fontSize: 11 }}>(Иркутск, вода 8°C, потери 200 Вт/м²)</span>:
                      </div>
                      {!heatingCalc
                        ? <div style={{ background: C, border: `1px dashed ${B}`, borderRadius: 12, padding: "13px 15px", fontSize: 13, color: "#475569", textAlign: "center" }}>← Введите размеры бассейна и желаемую температуру</div>
                        : <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#64748b" }}>
                              Нагрев воды: {heatingCalc.qHeat} кВт · Потери тепла: {heatingCalc.qLoss} кВт · Итого: {heatingCalc.qTotal} кВт
                            </div>
                            <CalcCard color={section.color}
                              selected={selectedHeating === `ЭН минимум ${heatingCalc.ehMin} кВт`}
                              onClick={() => setSelectedHeating(selectedHeating === `ЭН минимум ${heatingCalc.ehMin} кВт` ? null : `ЭН минимум ${heatingCalc.ehMin} кВт`)}
                              title="Минимум" subtitle="Поддерживает температуру в тёплую погоду" badge={`${heatingCalc.ehMin} кВт`} />
                            <CalcCard color={section.color}
                              selected={selectedHeating === `ЭН рекомендовано ${heatingCalc.ehRec} кВт`}
                              onClick={() => setSelectedHeating(selectedHeating === `ЭН рекомендовано ${heatingCalc.ehRec} кВт` ? null : `ЭН рекомендовано ${heatingCalc.ehRec} кВт`)}
                              title="Рекомендовано ★" subtitle="Запас ×1.4 на ночные перепады до 0°С в Иркутске" badge={`${heatingCalc.ehRec} кВт`} />
                          </div>
                      }
                    </div>
                  )}

                  {/* Обычные вопросы */}
                  {visibleQs.map((q) => (
                    <div key={q.key} style={{ animation: "fadeIn 0.2s ease" }}>
                      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 7, fontWeight: 500 }}>
                        {q.showIf && <span style={{ color: section.color + "99", marginRight: 5 }}>↳</span>}
                        {q.text}
                      </div>
                      {q.type === "input"
                        ? <input placeholder={q.placeholder} value={getAnswer(section.id, q.key) || ""} onChange={(e) => setAnswer(section.id, q.key, e.target.value)}
                            style={{ background: C, border: `1.5px solid ${getAnswer(section.id, q.key) ? section.color : B}`, borderRadius: 10, padding: "9px 13px", color: "#f1f5f9", fontSize: 14, width: "100%", boxSizing: "border-box", transition: "border-color 0.2s" }} />
                        : <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                            {q.options.map((opt) => {
                              const sel = getAnswer(section.id, q.key) === opt;
                              return <button key={opt} onClick={() => setAnswer(section.id, q.key, sel ? null : opt)}
                                style={{ background: sel ? section.color + "22" : C, border: `1.5px solid ${sel ? section.color : B}`, borderRadius: 99, padding: "6px 13px", color: sel ? section.color : "#94a3b8", fontSize: 13, cursor: "pointer", fontWeight: sel ? 600 : 400, transition: "all 0.2s" }}>
                                {sel ? "✓ " : ""}{opt}
                              </button>;
                            })}
                          </div>
                      }
                    </div>
                  ))}

                  <div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>📝 Заметки</div>
                    <textarea placeholder="Дополнительная информация..." value={notes[section.id] || ""} onChange={(e) => setNotes((p) => ({ ...p, [section.id]: e.target.value }))} rows={2}
                      style={{ background: C, border: `1.5px solid ${B}`, borderRadius: 10, padding: "9px 13px", color: "#94a3b8", fontSize: 13, width: "100%", boxSizing: "border-box", resize: "vertical", outline: "none", fontFamily: "inherit" }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Блок клиента + отправка */}
        <div style={{ marginTop: 6, background: "#1e293b", border: "1px solid #334155", borderRadius: 16, padding: "18px" }}>
          <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, marginBottom: 12 }}>👤 Данные клиента</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              placeholder="Имя клиента *"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              style={{ background: "#0f172a", border: `1.5px solid ${clientName ? "#06B6D4" : "#334155"}`, borderRadius: 10, padding: "10px 14px", color: "#f1f5f9", fontSize: 14, outline: "none", transition: "border-color 0.2s" }}
            />
            <input
              placeholder="Телефон (необязательно)"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              style={{ background: "#0f172a", border: "1.5px solid #334155", borderRadius: 10, padding: "10px 14px", color: "#f1f5f9", fontSize: 14, outline: "none" }}
            />
          </div>

          {/* Результат отправки */}
          {sendResult && (
            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: sendResult.success ? "#10B98122" : "#EF444422", border: `1px solid ${sendResult.success ? "#10B981" : "#EF4444"}`, fontSize: 13 }}>
              {sendResult.success ? (
                <span style={{ color: "#10B981" }}>
                  ✅ Заказ создан: <strong>{sendResult.orderName}</strong>
                  {" "}<a href={sendResult.orderUrl} target="_blank" rel="noreferrer" style={{ color: "#06B6D4" }}>Открыть в Мой склад →</a>
                </span>
              ) : (
                <span style={{ color: "#EF4444" }}>❌ Ошибка: {sendResult.error}</span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={sendToMS}
              disabled={sending}
              style={{ flex: 2, background: sending ? "#334155" : "linear-gradient(135deg,#F97316,#EF4444)", border: "none", borderRadius: 12, padding: "14px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: sending ? "not-allowed" : "pointer" }}
            >
              {sending ? "⏳ Отправляем..." : "📦 Создать заказ в Мой склад"}
            </button>
            <button
              onClick={exportText}
              style={{ flex: 1, background: "#0f172a", border: "1.5px solid #334155", borderRadius: 12, padding: "14px", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              💾 .txt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
