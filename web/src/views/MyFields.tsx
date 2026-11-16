/* My fields: every field this browser has analysed, to open, rename or remove. Shown to everyone; when signed in
   (demo) the left panel also lists them for quick switching. A real account would sync this list across devices. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconMap } from "../design";
import { useApp } from "../store";
import { usePlan } from "../planStore";
import AddToFarm from "../components/AddToFarm";

export default function MyFields() {
  const { t } = useTranslation();
  const saved = useApp((s) => s.savedFields);
  const current = useApp((s) => s.field?.id);
  const selectField = useApp((s) => s.selectField);
  const set = useApp((s) => s.set);
  const user = useApp((s) => s.user);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const rename = (id: string) => {
    const name = draft.trim().slice(0, 60);
    if (name) {
      const st = useApp.getState();
      set({
        savedFields: st.savedFields.map((f) => (f.id === id ? { ...f, name } : f)),
        ...(st.field?.id === id && st.field ? { field: { ...st.field, name } } : {}),
      });
    }
    setEditing(null);
  };
  const remove = (id: string, name: string) => {
    if (!window.confirm(t("myfields.confirm_remove", { name }))) return;
    set({ savedFields: useApp.getState().savedFields.filter((f) => f.id !== id) });
  };
  return (
    <div className="page myfields">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("myfields.title")}</h1>
          <p className="fs-meta">{user ? t("myfields.sub_signed", { name: user.name }) : t("myfields.sub")}</p>
        </div>
        <div className="fs-cluster">
          <Button variant="secondary" onClick={() => usePlan.getState().open("farm")}>
            {t("farm.see_farm")}
          </Button>
          <Button onClick={() => useApp.getState().setView("home")}>+ {t("myfields.add")}</Button>
        </div>
      </header>
      {saved.length ? (
        <ul className="myfields__list">
          {saved.map((f) => (
            <li key={f.id} className={f.id === current ? "myfields__item is-current" : "myfields__item"}>
              <span className="myfields__icon" aria-hidden="true">
                <IconMap size={20} />
              </span>
              <div className="myfields__main">
                {editing === f.id ? (
                  <form
                    className="myfields__rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      rename(f.id);
                    }}
                  >
                    <label className="fs-visually-hidden" htmlFor={`mf-${f.id}`}>
                      {t("myfields.rename_label")}
                    </label>
                    <input id={`mf-${f.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus maxLength={60} />
                    <Button size="sm" type="submit">
                      {t("myfields.save")}
                    </Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>
                      {t("signin.cancel")}
                    </Button>
                  </form>
                ) : (
                  <>
                    <strong>{f.name}</strong>
                    <span className="fs-meta">
                      {typeof f.lat === "number" && typeof f.lon === "number" ? `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}` : ""}
                      {f.id === current ? ` · ${t("myfields.open_now")}` : ""}
                    </span>
                  </>
                )}
              </div>
              {editing === f.id ? null : (
                <div className="myfields__actions">
                  <AddToFarm field={f} toggle />
                  <Button
                    size="sm"
                    onClick={() => {
                      selectField(f);
                      useApp.getState().setView("studio");
                    }}
                  >
                    {t("myfields.open")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setDraft(f.name);
                      setEditing(f.id);
                    }}
                  >
                    {t("myfields.rename")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(f.id, f.name)}>
                    {t("myfields.remove")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="myfields__empty">{t("myfields.empty")}</p>
      )}
      <p className="fs-meta myfields__note">{t("myfields.note")}</p>
    </div>
  );
}
