import type { LeadSource, LeadSourceType } from "../types";
import { GoogleMapsSource } from "./GoogleMapsSource";
import { UploadSource } from "./UploadSource";

class SourceRegistryClass {
  private sources: Map<LeadSourceType, LeadSource> = new Map();

  constructor() {
    this.registerSource(GoogleMapsSource);
    this.registerSource(UploadSource);
  }

  registerSource(source: LeadSource) {
    this.sources.set(source.type, source);
  }

  getSource(type: LeadSourceType): LeadSource | undefined {
    return this.sources.get(type);
  }

  getAllSources(): LeadSource[] {
    return Array.from(this.sources.values());
  }

  getAvailableSources(): LeadSource[] {
    // Future: filter based on user plan, feature flags, etc.
    return this.getAllSources();
  }

  getSupportedFormats(): string[] {
    return this.getAllSources()
      .filter((source) => source.type !== "google_maps")
      .map((source) => source.name);
  }
}

export const SourceRegistry = new SourceRegistryClass();
