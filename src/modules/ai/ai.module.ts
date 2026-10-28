import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiConversation,
  AiConversationSchema,
} from 'src/schemas/ai-conversation.schema';
import { ANTHROPIC_CLIENT } from './ai.constants';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiConversation.name, schema: AiConversationSchema },
    ]),
  ],
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: ANTHROPIC_CLIENT,
      useFactory: (configService: ConfigService) => {
        const apiKey = configService.get<string>('ai.apiKey');
        if (!apiKey) return null;
        return new Anthropic({ apiKey });
      },
      inject: [ConfigService],
    },
  ],
  exports: [AiService],
})
export class AiModule {}
