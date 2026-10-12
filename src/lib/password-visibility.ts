/**
 * Mostrar/ocultar contraseña (ícono de ojo) para los campos de PasswordField.
 *
 * Se usa delegación de eventos en el documento: los formularios de administración viven dentro de
 * <template> que AdminDialogHost inyecta con innerHTML (los scripts de esas plantillas no se ejecutan) y
 * puede haber varias instancias en la misma página. El valor escrito nunca se lee, guarda ni registra:
 * solo se cambia el atributo `type` del input.
 */
const TOGGLE = "[data-password-toggle]";

function parts(button: Element) {
  const id = button.getAttribute("aria-controls");
  const input = id ? document.getElementById(id) : null;
  return { input: input instanceof HTMLInputElement ? input : null, hidden: button.querySelector("[data-password-hidden-icon]"), shown: button.querySelector("[data-password-visible-icon]") };
}

/** Deja el campo en el estado indicado (visible = type text) y sincroniza etiqueta, aria-pressed e ícono. */
export function setPasswordVisible(button: Element, visible: boolean) {
  const { input, hidden, shown } = parts(button);
  if (!input) return;
  const label = visible ? "Ocultar contraseña" : "Mostrar contraseña";
  input.type = visible ? "text" : "password";
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(visible));
  button.setAttribute("title", label);
  hidden?.classList.toggle("hidden", visible);
  shown?.classList.toggle("hidden", !visible);
}

export function togglePasswordVisibility(button: Element) {
  const { input } = parts(button);
  if (input) setPasswordVisible(button, input.type === "password");
}

let installed: WeakSet<object> | null = null;

/** Instala (una sola vez por documento) los listeners delegados de clic y de envío. */
export function installPasswordVisibility(doc: Document = document) {
  installed ??= new WeakSet();
  if (installed.has(doc)) return;
  installed.add(doc);
  doc.addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof Element ? target.closest(TOGGLE) : null;
    if (button) togglePasswordVisibility(button);
  });
  // Al enviar (en captura, antes de otros manejadores) el campo vuelve a quedar oculto.
  doc.defaultView?.addEventListener("submit", (event) => {
    const form = event.target;
    if (form instanceof Element) form.querySelectorAll(TOGGLE).forEach((button) => setPasswordVisible(button, false));
  }, true);
  // Si la página vuelve desde el historial (bfcache), tampoco debe quedar visible.
  doc.defaultView?.addEventListener("pageshow", () => doc.querySelectorAll(TOGGLE).forEach((button) => setPasswordVisible(button, false)));
}
