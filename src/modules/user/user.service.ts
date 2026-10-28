import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  catchError,
  forkJoin,
  from,
  map,
  mergeMap,
  Observable,
  switchMap,
  throwError,
} from 'rxjs';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from 'src/schemas/user.schema';
import { Model } from 'mongoose';
import { UserQueryModel } from './dto/user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { escapeRegex } from 'src/utils/query';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  create(createUserDto: CreateUserDto) {
    const saltOrRounds = 10;
    const { password, ...restDto } = createUserDto;

    const email = restDto.email?.trim().toLowerCase();
    const username = restDto.username?.trim().toLowerCase();

    return from(
      this.userModel
        .findOne({ $or: [{ email }, { username }] })
        .select('_id email username')
        .lean()
        .exec(),
    ).pipe(
      switchMap(found => {
        if (found?.email === email) {
          return throwError(
            () => new ConflictException('Email already exists'),
          );
        }
        if (found?.username === username) {
          return throwError(
            () => new ConflictException('Username already exists'),
          );
        }
        return from(bcrypt.hash(password, saltOrRounds));
      }),
      switchMap(passwordHash => {
        const created = new this.userModel({
          ...restDto,
          email,
          username,
          passwordHash,
        });

        return from(created.save()).pipe(
          catchError(
            (err: {
              code?: number;
              keyPattern?: string;
              keyValue?: string;
            }) => {
              if (err?.code === 11000) {
                const dupField = Object.keys(
                  err.keyPattern ?? err.keyValue ?? {},
                )[0];
                if (dupField === 'email') {
                  return throwError(
                    () => new ConflictException('Email already exists'),
                  );
                }
                if (dupField === 'username') {
                  return throwError(
                    () => new ConflictException('Username already exists'),
                  );
                }
                return throwError(
                  () => new ConflictException('Duplicate value'),
                );
              }
              return throwError(() => err);
            },
          ),
        );
      }),
    );
  }

  findAll(filter?: UserQueryModel) {
    const q: Record<string, any> = {};

    if (filter?.email?.trim()) {
      q.email = { $regex: escapeRegex(filter.email.trim()), $options: 'i' };
    }

    if (filter?.username?.trim()) {
      q.username = {
        $regex: escapeRegex(filter.username.trim()),
        $options: 'i',
      };
    }

    if (filter?.name?.trim()) {
      q.name = { $regex: escapeRegex(filter.name.trim()), $options: 'i' };
    }

    if (filter?.role) q.role = filter.role;

    if (filter?.status !== undefined && filter?.status !== null) {
      q.status = filter.status;
    }

    return from(this.userModel.find(q).lean().exec());
  }

  findPaginated(query: UserQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(200, query.pageSize ?? 20));
    const q: Record<string, unknown> = {};

    const search = query.search?.trim();
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: 'i' };
      q.$or = [{ name: regex }, { username: regex }, { email: regex }];
    }
    if (query.role) q.role = query.role;
    if (query.status) q.status = query.status;

    return forkJoin([
      from(this.userModel.countDocuments(q)),
      from(
        this.userModel
          .find(q)
          .sort({ name: 1, _id: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean()
          .exec(),
      ),
    ]).pipe(
      map(([total, items]) => ({
        items,
        total,
        page,
        pageSize,
        totalPage: Math.ceil(total / pageSize),
      })),
    );
  }

  findOne(id: string) {
    return from(this.userModel.findById(id).lean().exec());
  }

  findOneByFilter(
    filter?: UserQueryModel,
    opts?: { includePasswordHash?: boolean },
  ): Observable<UserDocument | null> {
    const q: Record<string, any> = {};

    if (filter?.email?.trim()) {
      q.email = { $regex: escapeRegex(filter.email.trim()), $options: 'i' };
    }
    if (filter?.username?.trim()) {
      q.username = {
        $regex: escapeRegex(filter.username.trim()),
        $options: 'i',
      };
    }
    if (filter?.name?.trim()) {
      q.name = { $regex: escapeRegex(filter.name.trim()), $options: 'i' };
    }

    if (filter?.role) q.role = filter.role;
    if (filter?.status !== undefined && filter?.status !== null)
      q.status = filter.status;

    const query = this.userModel.findOne(q);

    if (opts?.includePasswordHash) {
      query.select('+passwordHash');
    }

    return from(query.exec());
  }

  update(id: string, updateUserDto: UpdateUserDto) {
    return from(
      this.userModel.findByIdAndUpdate(id, updateUserDto, { new: true }),
    );
  }

  remove(id: string): Observable<User> {
    return from(this.userModel.findByIdAndDelete(id).exec()).pipe(
      mergeMap(doc => {
        if (!doc) {
          return throwError(() => new NotFoundException('User not found'));
        }
        // trả về user vừa bị xoá
        return from([doc.toObject() as User]);
      }),
    );
  }
}
