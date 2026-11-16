import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import es from "./es.json";
// Strings for the plan, builder, saved-plans and validation views live in their own files.
import enPlan from "./en.plan.json";
import esPlan from "./es.plan.json";
// Whole-farm view (wave U9) and the wave U9 additions (disease, peers, offline, text alerts) have their own files.
import enFarm from "./en.farm.json";
import esFarm from "./es.farm.json";
import enU9 from "./en.u9.json";
import esU9 from "./es.u9.json";

let lang = "en";
try {
  const raw = localStorage.getItem("fieldshift-app");
  if (raw) lang = JSON.parse(raw)?.state?.lang ?? "en";
} catch {
  /* storage blocked */
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { ...en, ...enPlan, ...enFarm, ...enU9 } }, es: { translation: { ...es, ...esPlan, ...esFarm, ...esU9 } } },
  lng: lang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
