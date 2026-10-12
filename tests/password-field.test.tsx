/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { activate, installBrowser } from "./helpers/offline-env";

const browser = installBrowser("http://localhost:4321/administracion/usuarios");
const { default: PasswordField } = await import("../src/components/PasswordField");
const visibility = await import("../src/lib/password-visibility");
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

beforeEach(() => {
  activate(browser);
  document.body.innerHTML = "";
});

const mount = (html: string) => { document.body.insertAdjacentHTML("beforeend", html); };
const field = (props: Record<string, unknown> = {}) => renderToStaticMarkup(<PasswordField label="Nueva contraseña" name="password" minLength={8} {...props} />);

describe("PasswordField: marcado", () => {
  test("renderiza input oculto y botón de ojo accesible", () => {
    mount(field({ id: "pw-a" }));
    const input = document.getElementById("pw-a") as HTMLInputElement;
    const button = document.querySelector("[data-password-toggle]") as HTMLButtonElement;
    expect(input.type).toBe("password");
    expect(input.name).toBe("password");
    expect(input.required).toBe(true);
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(input.minLength).toBe(8);
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Mostrar contraseña");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe("pw-a");
    expect(button.className).toContain("size-11");
    expect(button.className).toContain("focus-visible:ring-2");
    expect(document.querySelector("label")?.getAttribute("for")).toBe("pw-a");
  });

  test("varias instancias tienen ids distintos (con y sin id explícito)", () => {
    mount(renderToStaticMarkup(<><PasswordField label="A" name="a" /><PasswordField label="B" name="b" /><PasswordField label="C" name="c" id="x" /></>));
    const inputIds = [...document.querySelectorAll("input")].map((input) => input.id);
    const buttonIds = [...document.querySelectorAll("button")].map((button) => button.id);
    expect(new Set(inputIds).size).toBe(3);
    expect(new Set(buttonIds).size).toBe(3);
    expect([...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-controls"))).toEqual(inputIds);
  });
});

describe("password-visibility: alternancia", () => {
  test("alterna password y text, aria-pressed, etiqueta e íconos; cada campo es independiente", () => {
    visibility.installPasswordVisibility(document);
    mount(field({ id: "pw-1" }) + field({ id: "pw-2", name: "password_confirm" }));
    const [b1, b2] = [...document.querySelectorAll<HTMLButtonElement>("[data-password-toggle]")];
    const [i1, i2] = [document.getElementById("pw-1") as HTMLInputElement, document.getElementById("pw-2") as HTMLInputElement];
    b1.click();
    expect(i1.type).toBe("text");
    expect(i2.type).toBe("password");
    expect(b1.getAttribute("aria-pressed")).toBe("true");
    expect(b1.getAttribute("aria-label")).toBe("Ocultar contraseña");
    expect(b1.querySelector("[data-password-hidden-icon]")?.classList.contains("hidden")).toBe(true);
    expect(b1.querySelector("[data-password-visible-icon]")?.classList.contains("hidden")).toBe(false);
    expect(b2.getAttribute("aria-pressed")).toBe("false");
    b2.click();
    expect(i2.type).toBe("text");
    b1.click();
    expect(i1.type).toBe("password");
    expect(b1.getAttribute("aria-pressed")).toBe("false");
    expect(b1.getAttribute("aria-label")).toBe("Mostrar contraseña");
  });

  test("funciona con contenido inyectado después (diálogo) y vuelve a oculto al enviar; no toca el valor ni almacenamiento", () => {
    visibility.installPasswordVisibility(document);
    mount(`<form id="f" onsubmit="return false">${field({ id: "dlg-pw" })}</form>`);
    const input = document.getElementById("dlg-pw") as HTMLInputElement;
    input.value = "Secreta-123";
    (document.querySelector("[data-password-toggle]") as HTMLButtonElement).click();
    expect(input.type).toBe("text");
    document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(input.type).toBe("password");
    expect(input.value).toBe("Secreta-123");
    expect(JSON.stringify(Object.entries(window.localStorage))).not.toContain("Secreta-123");
  });

  test("un diálogo reabierto con HTML nuevo empieza oculto", () => {
    visibility.installPasswordVisibility(document);
    const html = field({ id: "re-pw" });
    mount(html);
    (document.querySelector("[data-password-toggle]") as HTMLButtonElement).click();
    expect((document.getElementById("re-pw") as HTMLInputElement).type).toBe("text");
    document.body.innerHTML = "";
    mount(html);
    expect((document.getElementById("re-pw") as HTMLInputElement).type).toBe("password");
    expect(document.querySelector("[data-password-toggle]")?.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("formularios con PasswordField", () => {
  const count = (text: string) => text.match(/<PasswordField\b/g)?.length ?? 0;
  test("reset de contraseña: un ojo por campo con ids propios del usuario", () => {
    const text = source("src/components/UserPasswordResetAction.astro");
    expect(count(text)).toBe(2);
    expect(text).toContain('name="password"');
    expect(text).toContain('name="password_confirm"');
    expect(text.match(/minLength=\{MIN_PASSWORD_LENGTH\}/g)?.length).toBe(2);
    expect(text).toContain("${dialogId}-password`");
    expect(text).toContain("${dialogId}-password-confirm`");
    expect(text).not.toContain('type="password"');
  });
  test("alta de usuario: un ojo por campo", () => {
    const text = source("src/pages/administracion/usuarios.astro");
    expect(count(text)).toBe(2);
    expect(text).toContain('label="Contraseña inicial"');
    expect(text).toContain('name="password_confirm"');
    expect(text).not.toContain('type="password"');
  });
  test("configurar contraseña: un ojo por campo con minLength 8", () => {
    const text = source("src/pages/configurar-contrasena.astro");
    expect(count(text)).toBe(2);
    expect(text.match(/minLength=\{8\}/g)?.length).toBe(2);
    expect(text).not.toContain('type="password"');
  });
  test("el layout instala la alternancia y el login no cambia", () => {
    expect(source("src/layouts/BaseLayout.astro")).toContain("installPasswordVisibility()");
    expect(source("src/components/LoginCard.astro")).not.toContain("PasswordField");
  });
});
