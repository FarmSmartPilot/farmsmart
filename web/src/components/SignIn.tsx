/* Demo sign-in (placeholder): a button in the top bar and a small sign-in window. Nothing is checked or sent anywhere:
   any name (or none) and any password (or none) work, and "Test" signs in. Only the display name is kept, in this
   browser; the password is never stored. FarmSmart stays a public site with no account needed. */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconChevronDown, useFocusTrap } from "../design";
import { useApp } from "../store";
import { usePlan } from "../planStore";

export function SignInButton() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user);
  const set = useApp((s) => s.set);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  if (user) {
    return (
      <div className="menu signin-menu">
        <Button variant="ghost" iconAfter={<IconChevronDown size={14} />} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <span className="signin-avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          {user.name}
        </Button>
        {menu ? (
          <div className="menu__pop signin-pop" onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
            <p className="fs-meta signin-pop__note">{t("signin.demo_signed")}</p>
            <button
              type="button"
              className="menu__item"
              onClick={() => {
                setMenu(false);
                usePlan.getState().open("fields");
              }}
            >
              {t("myfields.manage")}
            </button>
            <button
              type="button"
              className="menu__item"
              onClick={() => {
                setMenu(false);
                set({ user: null });
              }}
            >
              {t("signin.out")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-tour="signin">
        {t("signin.button")}
      </Button>
      {open ? <SignInDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const set = useApp((s) => s.set);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose, { restoreFocus: true, initialFocus: "first" });
  const go = () => {
    // Demo only: keep a display name, drop the password, check nothing.
    set({ user: { name: name.trim().slice(0, 40) || t("signin.default_name") } });
    setPw("");
    onClose();
  };
  return (
    <div className="signin-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="signin-dialog" role="dialog" aria-modal="true" aria-labelledby="signin-h" tabIndex={-1}>
        <h2 id="signin-h">{t("signin.title")}</h2>
        <p className="signin-dialog__note">{t("signin.note")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <label className="signin-field">
            <span>{t("signin.name")}</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder={t("signin.name_ph")} />
          </label>
          <label className="signin-field">
            <span>{t("signin.password")}</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" placeholder={t("signin.password_ph")} />
          </label>
          <div className="signin-actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              {t("signin.cancel")}
            </Button>
            <Button type="submit">{t("signin.test")}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
