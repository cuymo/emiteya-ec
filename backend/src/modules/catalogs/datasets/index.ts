// Datasets normativos de la versión instalada (add-fiscal-catalogs, design D3). Cada catálogo tiene
// un archivo por versión; una versión nueva se añade aquí y nunca se edita una anterior. El
// manifiesto con sus fuentes está en docs/product/sri-catalogs/README.md.
import consumerFinalPolicy1 from "./consumer-final-policy/1.json" with { type: "json" };
import iceRate1 from "./ice-rate/1.json" with { type: "json" };
import identificationType1 from "./identification-type/1.json" with { type: "json" };
import irbpnrRate1 from "./irbpnr-rate/1.json" with { type: "json" };
import ivaRate1 from "./iva-rate/1.json" with { type: "json" };
import paymentMethod1 from "./payment-method/1.json" with { type: "json" };
import schemaRegistry1 from "./schema-registry/1.json" with { type: "json" };
import schemaRegistry2 from "./schema-registry/2.json" with { type: "json" };
import specialCaseMatrix1 from "./special-case-matrix/1.json" with { type: "json" };
import supportCode1 from "./support-code/1.json" with { type: "json" };
import supportDocumentType1 from "./support-document-type/1.json" with { type: "json" };
import tax1 from "./tax/1.json" with { type: "json" };
import withholdingIncomeConcept1 from "./withholding-income-concept/1.json" with { type: "json" };
import withholdingIvaCode1 from "./withholding-iva-code/1.json" with { type: "json" };
import withholdingTax1 from "./withholding-tax/1.json" with { type: "json" };

/** Archivos tal como están en el repositorio; `validateDatasets` los valida antes de usarlos. */
export const DATASET_FILES: readonly unknown[] = [
  identificationType1,
  tax1,
  ivaRate1,
  iceRate1,
  irbpnrRate1,
  paymentMethod1,
  consumerFinalPolicy1,
  schemaRegistry1,
  specialCaseMatrix1,
  schemaRegistry2,
  // add-withholding-receipts (design D7 a D11): tablas 19 y 20 de la ficha y el Catálogo ATS.
  withholdingTax1,
  withholdingIvaCode1,
  withholdingIncomeConcept1,
  supportDocumentType1,
  supportCode1,
];
