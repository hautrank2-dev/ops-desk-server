import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import configuration from './config/configuration';
import { UserModule } from './modules/user/user.module';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './modules/auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { AppGuard } from './app.guard';
import { AssetModule } from './modules/asset/asset.module';
import { DepartmentModule } from './modules/department/department.module';
import { TicketModule } from './modules/ticket/ticket.module';
import { AssetItemModule } from './modules/asset-item/asset-item.module';
import { LocationModule } from './modules/location/location.module';
import { TicketCommentModule } from './modules/ticket-comment/ticket-comment.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
      load: [configuration],
    }),
    JwtModule.register({
      global: true,
      secret: configuration().jwtSecret,
      signOptions: { expiresIn: '1d' },
    }),
    MongooseModule.forRoot(process.env.DATABASE_URL || ''),
    UserModule,
    AuthModule,
    AssetModule,
    DepartmentModule,
    TicketModule,
    AssetItemModule,
    LocationModule,
    TicketCommentModule,
    DashboardModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AppGuard,
    },
  ],
})
export class AppModule {}
