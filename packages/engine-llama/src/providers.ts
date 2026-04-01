import type {
  ModelProvider,
  ProviderDownloadPlan,
  ProviderDownloadRequest,
  ProviderId,
  ProviderModelSummary,
  ProviderSearchQuery,
  ProviderSearchResult,
} from "@localhub/shared-contracts/foundation-providers";

export interface ProviderSearchServiceOptions {
  fetch?: typeof fetch;
  huggingFaceBaseUrl?: string;
  modelScopeBaseUrl?: string;
}

interface JsonResponse {
  [key: string]: unknown;
}

const DEFAULT_HUGGINGFACE_BASE_URL = "https://huggingface.co";
const DEFAULT_MODELSCOPE_BASE_URL = "https://www.modelscope.cn";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toArtifactId(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .toLowerCase();
}

function mapFormat(fileName: string): "gguf" | undefined {
  return fileName.toLowerCase().endsWith(".gguf") ? "gguf" : undefined;
}

async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<JsonResponse | JsonResponse[]> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Provider request failed with status ${response.status} for ${url}`);
  }

  return (await response.json()) as JsonResponse | JsonResponse[];
}

function normalizeHuggingFaceItem(baseUrl: string, item: JsonResponse): ProviderModelSummary {
  const providerModelId = toOptionalString(item.id) ?? "unknown/model";
  const files = Array.isArray(item.siblings) ? item.siblings : [];
  const artifacts = files
    .map((entry) => (entry && typeof entry === "object" ? (entry as JsonResponse) : undefined))
    .filter((entry): entry is JsonResponse => Boolean(entry))
    .map((entry) => {
      const fileName = toOptionalString(entry.rfilename) ?? toOptionalString(entry.path);
      if (!fileName) {
        return undefined;
      }

      const format = mapFormat(fileName);
      if (!format) {
        return undefined;
      }

      const artifact: ProviderModelSummary["artifacts"][number] = {
        artifactId: toArtifactId(fileName),
        fileName,
        format,
        downloadUrl: `${normalizeBaseUrl(baseUrl)}/${providerModelId}/resolve/main/${fileName}`,
      };

      const sizeBytes = toOptionalNumber(entry.size);
      if (sizeBytes !== undefined) {
        artifact.sizeBytes = sizeBytes;
      }

      return artifact;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const summary: ProviderModelSummary = {
    provider: "huggingface",
    providerModelId,
    title: toOptionalString(item.id)?.split("/").at(-1) ?? providerModelId,
    repositoryUrl: `${normalizeBaseUrl(baseUrl)}/${providerModelId}`,
    tags: toStringArray(item.tags),
    formats: artifacts.map((artifact) => artifact.format),
    artifacts,
  };

  const author = toOptionalString(item.author);
  const license = toOptionalString(item.license);
  const downloads = toOptionalNumber(item.downloads);
  const likes = toOptionalNumber(item.likes);
  const updatedAt = toOptionalString(item.lastModified);
  const description = toOptionalString(item.description);

  if (author) {
    summary.author = author;
  }
  if (license) {
    summary.license = license;
  }
  if (downloads !== undefined) {
    summary.downloads = downloads;
  }
  if (likes !== undefined) {
    summary.likes = likes;
  }
  if (updatedAt) {
    summary.updatedAt = updatedAt;
  }
  if (description) {
    summary.description = description;
  }

  return summary;
}

function normalizeModelScopeItem(baseUrl: string, item: JsonResponse): ProviderModelSummary {
  const providerModelId =
    toOptionalString(item.Path) ?? toOptionalString(item.ModelId) ?? "unknown/model";
  const rawFiles = Array.isArray(item.Files) ? item.Files : [];
  const artifacts = rawFiles
    .map((entry) => (entry && typeof entry === "object" ? (entry as JsonResponse) : undefined))
    .filter((entry): entry is JsonResponse => Boolean(entry))
    .map((entry) => {
      const fileName = toOptionalString(entry.Path) ?? toOptionalString(entry.Name);
      if (!fileName) {
        return undefined;
      }

      const format = mapFormat(fileName);
      if (!format) {
        return undefined;
      }

      const artifact: ProviderModelSummary["artifacts"][number] = {
        artifactId: toArtifactId(fileName),
        fileName,
        format,
        downloadUrl: `${normalizeBaseUrl(baseUrl)}/api/v1/models/${providerModelId}/repo?Revision=master&FilePath=${encodeURIComponent(fileName)}`,
      };

      const sizeBytes = toOptionalNumber(entry.Size);
      if (sizeBytes !== undefined) {
        artifact.sizeBytes = sizeBytes;
      }

      return artifact;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const summary: ProviderModelSummary = {
    provider: "modelscope",
    providerModelId,
    title: toOptionalString(item.Name) ?? providerModelId.split("/").at(-1) ?? providerModelId,
    repositoryUrl: `${normalizeBaseUrl(baseUrl)}/models/${providerModelId}`,
    tags: toStringArray(item.Tags),
    formats: artifacts.map((artifact) => artifact.format),
    artifacts,
  };

  const author = toOptionalString(item.Owner);
  const license = toOptionalString(item.License);
  const downloads = toOptionalNumber(item.DownloadCount);
  const likes = toOptionalNumber(item.LikeCount);
  const updatedAt = toOptionalString(item.UpdatedAt);
  const description = toOptionalString(item.Description);

  if (author) {
    summary.author = author;
  }
  if (license) {
    summary.license = license;
  }
  if (downloads !== undefined) {
    summary.downloads = downloads;
  }
  if (likes !== undefined) {
    summary.likes = likes;
  }
  if (updatedAt) {
    summary.updatedAt = updatedAt;
  }
  if (description) {
    summary.description = description;
  }

  return summary;
}

export class HuggingFaceProvider implements ModelProvider {
  readonly id = "huggingface" as const;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;

  constructor(options: ProviderSearchServiceOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#baseUrl = normalizeBaseUrl(options.huggingFaceBaseUrl ?? DEFAULT_HUGGINGFACE_BASE_URL);
  }

  async search(query: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const url = new URL(`${this.#baseUrl}/api/models`);
    url.searchParams.set("search", query.text);
    url.searchParams.set("limit", String(query.limit));
    url.searchParams.set("full", "true");

    const startedAt = Date.now();
    const payload = await readJson(this.#fetch, url.toString());
    const items = Array.isArray(payload)
      ? payload.map((item) => normalizeHuggingFaceItem(this.#baseUrl, item))
      : [];

    return {
      items: items.filter((item) => item.artifacts.length > 0),
      warnings: [],
      sourceLatencyMs: Date.now() - startedAt,
    };
  }

  async resolveDownload(request: ProviderDownloadRequest): Promise<ProviderDownloadPlan> {
    const searchResult = await this.search({
      text: request.providerModelId,
      formats: ["gguf"],
      limit: 10,
    });
    const model = searchResult.items.find(
      (item) => item.providerModelId === request.providerModelId,
    );
    const artifact = model?.artifacts.find((item) => item.artifactId === request.artifactId);
    if (!model || !artifact || !artifact.downloadUrl) {
      throw new Error(
        `Unable to resolve HuggingFace artifact ${request.providerModelId}:${request.artifactId}.`,
      );
    }

    const head = await this.#fetch(artifact.downloadUrl, { method: "HEAD" });
    const totalBytes = toOptionalNumber(Number(head.headers.get("content-length")));
    const acceptsRanges = head.headers.get("accept-ranges")?.includes("bytes") ?? false;

    return {
      provider: this.id,
      artifactId: request.artifactId,
      url: artifact.downloadUrl,
      headers: {},
      fileName: artifact.fileName,
      supportsRange: acceptsRanges,
      ...(totalBytes !== undefined ? { estimatedSizeBytes: totalBytes } : {}),
      ...(artifact.checksum ? { checksum: artifact.checksum } : {}),
    };
  }
}

export class ModelScopeProvider implements ModelProvider {
  readonly id = "modelscope" as const;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;

  constructor(options: ProviderSearchServiceOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#baseUrl = normalizeBaseUrl(options.modelScopeBaseUrl ?? DEFAULT_MODELSCOPE_BASE_URL);
  }

  async search(query: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const url = new URL(`${this.#baseUrl}/api/v1/models`);
    url.searchParams.set("Search", query.text);
    url.searchParams.set("PageSize", String(query.limit));

    const startedAt = Date.now();
    const payload = (await readJson(this.#fetch, url.toString())) as JsonResponse;
    const data = Array.isArray(payload.Data) ? payload.Data : [];
    const items = data.map((item) => normalizeModelScopeItem(this.#baseUrl, item as JsonResponse));

    return {
      items: items.filter((item) => item.artifacts.length > 0),
      warnings: [],
      sourceLatencyMs: Date.now() - startedAt,
    };
  }

  async resolveDownload(request: ProviderDownloadRequest): Promise<ProviderDownloadPlan> {
    const searchResult = await this.search({
      text: request.providerModelId,
      formats: ["gguf"],
      limit: 10,
    });
    const model = searchResult.items.find(
      (item) => item.providerModelId === request.providerModelId,
    );
    const artifact = model?.artifacts.find((item) => item.artifactId === request.artifactId);
    if (!model || !artifact || !artifact.downloadUrl) {
      throw new Error(
        `Unable to resolve ModelScope artifact ${request.providerModelId}:${request.artifactId}.`,
      );
    }

    const head = await this.#fetch(artifact.downloadUrl, { method: "HEAD" });
    const totalBytes = toOptionalNumber(Number(head.headers.get("content-length")));
    const acceptsRanges = head.headers.get("accept-ranges")?.includes("bytes") ?? false;

    return {
      provider: this.id,
      artifactId: request.artifactId,
      url: artifact.downloadUrl,
      headers: {},
      fileName: artifact.fileName,
      supportsRange: acceptsRanges,
      ...(totalBytes !== undefined ? { estimatedSizeBytes: totalBytes } : {}),
      ...(artifact.checksum ? { checksum: artifact.checksum } : {}),
    };
  }
}

export class ProviderSearchService {
  readonly #providers: Map<ProviderId, ModelProvider>;

  constructor(providers: ModelProvider[]) {
    this.#providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  listProviders(): ProviderId[] {
    return Array.from(this.#providers.keys());
  }

  getProvider(providerId: ProviderId): ModelProvider {
    const provider = this.#providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown model provider: ${providerId}`);
    }

    return provider;
  }

  async search(
    query: ProviderSearchQuery,
    providerIds: ProviderId[] = this.listProviders(),
  ): Promise<ProviderSearchResult> {
    const startedAt = Date.now();
    const settled = await Promise.allSettled(
      providerIds.map(async (providerId) => this.getProvider(providerId).search(query)),
    );
    const warnings: string[] = [];
    const items: ProviderModelSummary[] = [];

    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") {
        items.push(...result.value.items);
        warnings.push(...result.value.warnings);
      } else {
        warnings.push(
          `${providerIds[index]} search failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    }

    items.sort((left, right) => (right.downloads ?? 0) - (left.downloads ?? 0));

    return {
      items: items.slice(0, query.limit),
      warnings,
      sourceLatencyMs: Date.now() - startedAt,
    };
  }
}

export function createDefaultProviderSearchService(
  options: ProviderSearchServiceOptions = {},
): ProviderSearchService {
  return new ProviderSearchService([
    new HuggingFaceProvider(options),
    new ModelScopeProvider(options),
  ]);
}
