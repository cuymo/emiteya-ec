// Escritura XML determinista y segura para los builders propios (Q-44, add-invoice-emission design
// D12). Un árbol de nodos con los nombres fijos del builder: el texto y los atributos siempre se
// escapan, un carácter que XML 1.0 no admite se rechaza y la salida es UTF-8 con sangría fija. No
// sabe nada del SRI ni de la factura.

export type XmlNode = Readonly<{
  name: string;
  attributes: readonly (readonly [string, string])[];
  children: readonly XmlNode[];
  text: string | null;
}>;

/** Texto con un carácter que XML 1.0 no admite, o nombre de nodo inválido. */
export class XmlWriterError extends Error {
  constructor() {
    super("XML_INVALID_CONTENT");
    this.name = "XmlWriterError";
  }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
// Caracteres de XML 1.0 (sección 2.2): fuera de este conjunto, el documento no se puede leer. La
// lista nombra a propósito los únicos controles admitidos: tabulador, salto de línea y retorno.
// eslint-disable-next-line no-control-regex
const INVALID_CHARACTER = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/u;

function checkName(name: string): string {
  if (!NAME.test(name)) throw new XmlWriterError();
  return name;
}

function escapeText(value: string): string {
  if (INVALID_CHARACTER.test(value)) throw new XmlWriterError();
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, "&quot;");

/** Elemento con hijos; un hijo `null` es un opcional que no corresponde y no se escribe. */
export function element(
  name: string,
  children: readonly (XmlNode | null)[],
  attributes: readonly (readonly [string, string])[] = [],
): XmlNode {
  return {
    name: checkName(name),
    attributes: attributes.map(([key, value]) => [checkName(key), value] as const),
    children: children.filter((child): child is XmlNode => child !== null),
    text: null,
  };
}

/** Elemento con texto. */
export function leaf(name: string, text: string): XmlNode {
  return { name: checkName(name), attributes: [], children: [], text };
}

/** Elemento con texto solo si hay valor. */
export const optionalLeaf = (name: string, text: string | null): XmlNode | null =>
  text === null ? null : leaf(name, text);

function write(node: XmlNode, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth);
  const attributes = node.attributes
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join("");
  if (node.text !== null) {
    out.push(`${indent}<${node.name}${attributes}>${escapeText(node.text)}</${node.name}>`);
    return;
  }
  out.push(`${indent}<${node.name}${attributes}>`);
  for (const child of node.children) write(child, depth + 1, out);
  out.push(`${indent}</${node.name}>`);
}

/** Documento con declaración UTF-8, dos espacios por nivel y saltos de línea `\n`. */
export function serializeXml(root: XmlNode): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>'];
  write(root, 0, out);
  return `${out.join("\n")}\n`;
}
