// Fixture: el transporte de sri-engine sí usa fetch y el parser XML (design D10 y D11).
import { XMLParser } from "fast-xml-parser";

export const call = () => fetch("https://example.invalid");
export { XMLParser };
