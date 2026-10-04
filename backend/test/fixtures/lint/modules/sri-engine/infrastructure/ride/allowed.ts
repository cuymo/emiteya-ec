// Fixture: la infraestructura del RIDE sí carga sus librerías y el parser XML.
import pdfmake from "pdfmake";
import bwipjs from "bwip-js";
import * as fontkit from "fontkit";
import { XMLParser } from "fast-xml-parser";

export const loaded = [pdfmake, bwipjs, fontkit, XMLParser];
