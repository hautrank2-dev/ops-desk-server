import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFiles,
  Req,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import { TicketService } from './ticket.service';
import {
  CreateTicketDto,
  CreateTicketFromDataDto,
  TicketImageFormDataDto,
} from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { TicketDetailQueryDto, TicketQueryDto } from './dto/ticket-query.dto';
import {
  AddTicketAssetItemDto,
  RemoveTicketAssetItemDto,
  TicketAssetItemQueryDto,
} from './dto/ticket-item.dto';
import { AssetItemQueryDto } from '../asset-item/dto/asset-item-query.dto';

@Controller('ticket')
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Asset data',
    type: CreateTicketFromDataDto,
  })
  @UseInterceptors(FilesInterceptor('images', 2))
  @Post()
  create(
    @Body() createTicketDto: CreateTicketDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() request: Request,
  ) {
    if (!request.payload) {
      throw new ForbiddenException('Invalid Authorization');
    }
    return this.ticketService.create(
      createTicketDto,
      request.payload.userId,
      files,
    );
  }

  @Get()
  findAll(@Query() query: TicketQueryDto) {
    return this.ticketService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Query() query: TicketDetailQueryDto) {
    return this.ticketService.findOne(id, query.populations);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTicketDto: UpdateTicketDto,
    @Req() request: Request,
  ) {
    if (!request.payload) {
      throw new ForbiddenException('Invalid Authorization');
    }
    return this.ticketService.update(
      id,
      updateTicketDto,
      request.payload.userId,
    );
  }

  @Get(':id/items')
  getItems(
    @Param('id') id: string,
    @Query() query: TicketAssetItemQueryDto,
    @Req() request: Request,
  ) {
    if (!request.payload) {
      throw new ForbiddenException('Invalid Authorization');
    }
    return this.ticketService.getItems(id, query);
  }

  @ApiBody({
    description: 'Ticket items',
    type: TicketImageFormDataDto,
  })
  @Post(':id/items')
  addItems(
    @Param('id') id: string,
    @Body() dto: AddTicketAssetItemDto,
    @Req() request: Request,
  ) {
    if (!request.payload) {
      throw new ForbiddenException('Invalid Authorization');
    }
    return this.ticketService.addItems(id, dto, request.payload.userId);
  }

  @ApiBody({
    description: 'Ticket items',
    type: TicketImageFormDataDto,
  })
  @Post(':id/remove-items')
  removeItems(
    @Param('id') id: string,
    @Body() dto: RemoveTicketAssetItemDto,
    @Req() request: Request,
  ) {
    if (!request.payload) {
      throw new ForbiddenException('Invalid Authorization');
    }
    return this.ticketService.removeItems(id, dto, request.payload.userId);
  }

  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Ticket images',
    type: TicketImageFormDataDto,
  })
  @UseInterceptors(FilesInterceptor('images', 2))
  @Post(':id/images')
  addImage(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() request: Request,
  ) {
    if (!request.payload) {
      throw new ForbiddenException('Invalid Authorization');
    }
    return this.ticketService.addImages(id, files, request.payload.userId);
  }

  @Delete(':id/images/:imgIndex')
  removeImages(
    @Param('id') id: string,
    @Param('imgIndex') imgIndex: string,
    @Req() request: Request,
  ) {
    if (!request.payload) {
      throw new ForbiddenException('Invalid Authorization');
    }
    return this.ticketService.removeImages(
      id,
      +imgIndex,
      request.payload.userId,
    );
  }
}
