import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { buildPage, decodeCursor, type Page } from '../domain/pagination.js';
import type {
  CatalogueRepository,
  CategoryRow,
  ListProductsFilter,
  ProductDetailRow,
  ProductSummaryRow,
} from '../ports/catalogue-repository.js';

export type CatalogueServiceDeps = { catalogue: CatalogueRepository };

/** Read-only public catalogue (docs/14 §3.2-3.3). */
export class CatalogueService {
  private readonly catalogue: CatalogueRepository;

  constructor({ catalogue }: CatalogueServiceDeps) {
    this.catalogue = catalogue;
  }

  listCategories(scope: BusinessScope): Promise<CategoryRow[]> {
    return this.catalogue.listCategories(scope);
  }

  async listProducts(
    scope: BusinessScope,
    filter: { categoryId?: string; q?: string; limit: number; cursor?: string },
  ): Promise<Page<ProductSummaryRow>> {
    const repoFilter: ListProductsFilter = {
      limit: filter.limit,
      cursor: filter.cursor ? decodeCursor(filter.cursor) : undefined,
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      ...(filter.q ? { q: filter.q } : {}),
    };

    const rows = await this.catalogue.listProducts(scope, { ...repoFilter, limit: filter.limit + 1 });
    return buildPage(rows, filter.limit, (row) => ({ sortValue: row.name, id: row.id }));
  }

  async getProductBySlug(scope: BusinessScope, slug: string): Promise<ProductDetailRow> {
    const product = await this.catalogue.getProductBySlug(scope, slug);
    if (!product) throw new DomainError('PRODUCT_NOT_FOUND', 'Product not found.');
    return product;
  }
}
