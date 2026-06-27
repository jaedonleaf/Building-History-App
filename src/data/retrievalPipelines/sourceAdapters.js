import { createCamraSourceAdapter } from "./adapters/camra.js";
import {
  createHistoricEnglandWhyBuiltAdapter,
  createWikidataWhyBuiltAdapter,
  createWikipediaWhyBuiltAdapter,
} from "./adapters/whyBuiltSources.js";

export function createDefaultSourceAdapters(options = {}) {
  return [
    createCamraSourceAdapter(options.camra),
    createHistoricEnglandWhyBuiltAdapter(),
    createWikidataWhyBuiltAdapter(),
    createWikipediaWhyBuiltAdapter(),
  ];
}
