import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Ticket, TicketDocument } from 'src/schemas/ticket.schema';
import { Model, QueryFilter, Types } from 'mongoose';
import {
  catchError,
  defer,
  forkJoin,
  from,
  map,
  Observable,
  of,
  switchMap,
  throwError,
} from 'rxjs';
import { UploadService } from 'src/services/upload.service';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { TableResponse } from 'src/types/response';
import {
  AddTicketAssetItemDto,
  RemoveTicketAssetItemDto,
  TicketAssetItemQueryDto,
} from './dto/ticket-item.dto';
import { AssetItemService } from '../asset-item/asset-item.service';
import { ItemStatus } from 'src/schemas/item.schema';
import { TicketPriority, TicketStatus } from 'src/schemas/ticket.schema';
import { escapeRegex } from 'src/utils/query';

// Enum fields are sorted by business rank, not alphabetically.
const RANKED_SORT: Record<string, string[]> = {
  priority: Object.values(TicketPriority),
  status: Object.values(TicketStatus),
};

@Injectable()
export class TicketService {
  constructor(
    @InjectModel(Ticket.name) private readonly ticketModel: Model<Ticket>,
    private readonly uploadSrv: UploadService,
    private readonly assetItemSrv: AssetItemService,
  ) {}

  create(dto: CreateTicketDto, userId: string, files?: Express.Multer.File[]) {
    const { assetItems, ...rest } = dto;

    const upload$ =
      files && files.length > 0
        ? forkJoin(
            files.map(file =>
              defer(() => this.uploadSrv.uploadFile(file, ['ticket'])),
            ),
          )
        : of([]);

    return upload$.pipe(
      switchMap(imageUrls =>
        // Code is auto-generated; createTicketDocument retries on the rare
        // unique-code race so we never surface a duplicate-key error.
        from(
          this.createTicketDocument({
            ...rest,
            assetItemIds: assetItems.map(id => new Types.ObjectId(id)),
            imageUrls,
            createdBy: new Types.ObjectId(userId),
          }),
        ).pipe(
          switchMap(ticket => {
            const updateItems$ = assetItems.map(itemId =>
              this.assetItemSrv
                .update(itemId, { status: ItemStatus.Maintenance })
                .pipe(
                  catchError(() =>
                    throwError(
                      () =>
                        new BadRequestException(
                          `Asset item ${itemId} not found, or an error occurred during the update.`,
                        ),
                    ),
                  ),
                ),
            );

            return (updateItems$.length ? forkJoin(updateItems$) : of([])).pipe(
              map(() => ticket),
            );
          }),
        ),
      ),
    );
  }

  /**
   * Build the next ticket code, e.g. OPS-000123. Codes are zero-padded to a
   * fixed width so lexicographic sort matches numeric order.
   */
  private async generateTicketCode(): Promise<string> {
    const PREFIX = 'OPS-';
    const WIDTH = 6;

    const last = await this.ticketModel
      .findOne({ code: { $regex: `^${PREFIX}\\d+$` } })
      .sort({ code: -1 })
      .select('code')
      .lean();

    let next = 1;
    if (last?.code) {
      const parsed = parseInt(last.code.slice(PREFIX.length), 10);
      if (!Number.isNaN(parsed)) next = parsed + 1;
    }

    return `${PREFIX}${String(next).padStart(WIDTH, '0')}`;
  }

  private async createTicketDocument(
    data: Record<string, unknown>,
  ): Promise<TicketDocument> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = await this.generateTicketCode();
      try {
        return await new this.ticketModel({ ...data, code }).save();
      } catch (err: any) {
        // Duplicate code (concurrent create) → regenerate and retry.
        if (err?.code === 11000 && attempt < 4) continue;
        throw err;
      }
    }
    throw new ConflictException('Unable to generate a unique ticket code');
  }

  findAll(filters: TicketQueryDto): Observable<TableResponse<Ticket>> {
    const {
      code,
      title,
      type,
      priority,
      status,
      assetItemIds,
      locationId,
      assigneeId,
      departmentId,
      startDueAt,
      endDueAt,
      startCreatedAt,
      endCreatedAt,
      page = 1,
      pageSize = 20,
      sortBy = 'createdAt',
      order = 'desc',
      populations,
      createdBy,
    } = filters;

    const filter: QueryFilter<Ticket> = {};

    // text search (partial, case-insensitive)
    if (code) filter.code = { $regex: escapeRegex(code), $options: 'i' };
    if (title) filter.title = { $regex: escapeRegex(title), $options: 'i' };

    // enums
    if (type) filter.type = type;
    if (priority) filter.priority = priority;
    if (status) filter.status = status;

    // ids
    if (assetItemIds) filter.assetItemIds = { $all: assetItemIds };
    if (locationId) filter.locationId = locationId;

    if (assigneeId) filter.assigneeId = assigneeId;
    if (createdBy) filter.createdBy = createdBy;

    if (departmentId) filter.departmentId = departmentId;

    // dueAt range
    if (startDueAt || endDueAt) {
      filter.dueAt = {};
      if (startDueAt) filter.dueAt.$gte = new Date(startDueAt);
      if (endDueAt) filter.dueAt.$lte = new Date(endDueAt);
    }

    // createdAt range
    if (startCreatedAt || endCreatedAt) {
      const createdAt: { $gte?: Date; $lte?: Date } = {};
      if (startCreatedAt) createdAt.$gte = new Date(startCreatedAt);
      if (endCreatedAt) createdAt.$lte = new Date(endCreatedAt);
      filter.createdAt = createdAt;
    }

    // pagination
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.max(1, Math.min(200, Number(pageSize) || 20));
    const skip = (safePage - 1) * safePageSize;

    // sorting
    const allowedSort = new Set([
      'createdAt',
      'updatedAt',
      'dueAt',
      'priority',
      'status',
      'code',
      'title',
    ]);
    const safeSortBy = allowedSort.has(sortBy) ? sortBy : 'createdAt';
    const dir = order === 'asc' ? 1 : -1;

    const count$ = from(this.ticketModel.countDocuments(filter));

    const rankOrder = RANKED_SORT[safeSortBy];
    const data$ = rankOrder
      ? from(
          this.findRankSorted(
            filter,
            safeSortBy,
            rankOrder,
            dir,
            skip,
            safePageSize,
            populations,
          ),
        )
      : from(
          this.ticketModel
            .find(filter)
            .sort({ [safeSortBy]: dir, _id: dir })
            .skip(skip)
            .limit(safePageSize)
            .populate(populations ?? [])
            .lean()
            .exec(),
        );

    return forkJoin([count$, data$]).pipe(
      map(([total, items]) => {
        return {
          total,
          totalPage: Math.ceil(total / safePageSize),
          items: items as Ticket[],
          page: safePage,
          pageSize: safePageSize,
        };
      }),
    );
  }

  /** Sort an enum field by its declared order (e.g. Low < ... < Urgent). */
  private async findRankSorted(
    filter: QueryFilter<Ticket>,
    field: string,
    rankOrder: string[],
    dir: 1 | -1,
    skip: number,
    limit: number,
    populations?: string[],
  ) {
    // Aggregate does not cast, so cast the filter through a query first.
    const match = this.ticketModel.find().cast(this.ticketModel, filter);
    const items = await this.ticketModel.aggregate([
      { $match: match },
      { $addFields: { _rank: { $indexOfArray: [rankOrder, `$${field}`] } } },
      { $sort: { _rank: dir, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { _rank: 0 } },
    ]);
    return populations?.length
      ? this.ticketModel.populate(items, populations.join(' '))
      : items;
  }

  findOne(id: string, populations?: string[]): Observable<Ticket> {
    return from(
      this.ticketModel
        .findById(id)
        .populate(populations ?? [])
        .lean(),
    ).pipe(
      map(res => {
        if (!res) {
          throw new NotFoundException('Ticket not found');
        }
        return res;
      }),
    );
  }

  update(id: string, updateTicketDto: UpdateTicketDto, userId: string) {
    return from(
      this.ticketModel.findByIdAndUpdate(
        id,
        { ...updateTicketDto, updatedBy: new Types.ObjectId(userId) },
        { new: true },
      ),
    ).pipe(
      map(ticket => {
        if (!ticket) {
          throw new NotFoundException('Asset not found');
        }
        return ticket;
      }),
    );
  }

  getItems(id: string, query: TicketAssetItemQueryDto) {
    return from(this.ticketModel.findById(id)).pipe(
      switchMap(ticket => {
        if (!ticket) {
          return throwError(() => new NotFoundException('Ticket not found'));
        }
        return from(
          this.assetItemSrv.findByIds(
            ticket.assetItemIds.map(e => e.toString()),
            query?.populations,
          ),
        );
      }),
    );
  }

  addItems(id: string, dto: AddTicketAssetItemDto, userId: string) {
    const invalidId = dto.itemIds.find(
      itemId => !Types.ObjectId.isValid(itemId),
    );
    if (invalidId) {
      return throwError(
        () => new BadRequestException(`${invalidId} is not a valid ID`),
      );
    }

    return from(this.ticketModel.findById(id)).pipe(
      switchMap(ticket => {
        if (!ticket) {
          return throwError(() => new NotFoundException('Ticket not found'));
        }

        const updateItems$ = dto.itemIds.map(itemId =>
          this.assetItemSrv
            .update(itemId, { status: ItemStatus.Maintenance })
            .pipe(
              catchError(() =>
                throwError(
                  () =>
                    new BadRequestException(
                      `Asset item ${itemId} not found, or an error occurred during the update.`,
                    ),
                ),
              ),
            ),
        );

        return (updateItems$.length ? forkJoin(updateItems$) : of([])).pipe(
          switchMap(() => {
            ticket.assetItemIds.push(
              ...dto.itemIds.map(itemId => new Types.ObjectId(itemId)),
            );
            ticket.updatedBy = new Types.ObjectId(userId);
            return from(ticket.save());
          }),
        );
      }),
    );
  }

  removeItems(id: string, dto: RemoveTicketAssetItemDto, userId: string) {
    const invalidId = dto.itemIds.find(
      itemId => !Types.ObjectId.isValid(itemId),
    );
    if (invalidId) {
      return throwError(
        () => new BadRequestException(`${invalidId} is not a valid ID`),
      );
    }

    return from(this.ticketModel.findById(id)).pipe(
      switchMap(ticket => {
        if (!ticket) {
          return throwError(() => new NotFoundException('Asset not found'));
        }

        const needRemoveItemIds: string[] = [];

        const newItems = ticket.assetItemIds.filter(itemId => {
          const itemIdStr = itemId.toString();
          if (dto.itemIds.includes(itemIdStr)) {
            needRemoveItemIds.push(itemIdStr);
            return false;
          }

          return true;
        });

        ticket.assetItemIds = newItems;
        ticket.updatedBy = new Types.ObjectId(userId);

        const removeItems$ = needRemoveItemIds.map(itemId =>
          this.assetItemSrv.update(itemId, { status: ItemStatus.Active }),
        );

        return from(ticket.save()).pipe(
          switchMap(() => {
            return removeItems$.length > 0 ? forkJoin(removeItems$) : of([]);
          }),
        );
      }),
    );
  }

  addImages(id: string, imgs: Express.Multer.File[], userId: string) {
    return from(this.ticketModel.findById(id)).pipe(
      switchMap(ticket => {
        if (!ticket) {
          return throwError(() => new NotFoundException('Asset not found'));
        }
        const upload$ = imgs
          ? forkJoin(
              imgs.map(file =>
                defer(() => this.uploadSrv.uploadFile(file, ['ticket'])),
              ),
            )
          : of([]);

        return upload$.pipe(
          switchMap(imgUrls => {
            ticket.imageUrls.push(...imgUrls);
            ticket.updatedBy = new Types.ObjectId(userId);
            return from(ticket.save());
          }),
        );
      }),
    );
  }

  removeImages(id: string, index: number, userId: string) {
    return from(this.ticketModel.findById(id)).pipe(
      switchMap(ticket => {
        if (!ticket) {
          return throwError(() => new NotFoundException('Asset not found'));
        }

        if (index < 0 || index >= ticket.imageUrls.length) {
          return throwError(
            () => new BadRequestException('Invalid image index'),
          );
        }

        const removedImgUrl = ticket.imageUrls[index];

        return this.uploadSrv.removeFile(removedImgUrl).pipe(
          switchMap(() => {
            ticket.imageUrls.splice(index, 1);
            ticket.updatedBy = new Types.ObjectId(userId);
            return from(ticket.save());
          }),
        );
      }),
    );
  }
}
