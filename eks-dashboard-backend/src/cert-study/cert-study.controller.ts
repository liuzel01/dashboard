import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { CertStudyService } from './cert-study.service';
import { ListQuestionsDto } from './dto/list-questions.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { ImportQuestionsDto } from './dto/import-questions.dto';

@Controller('cert-study')
export class CertStudyController {
  constructor(private readonly service: CertStudyService) {}

  @Get('exams')
  async listExams(@Headers('authorization') authorization?: string) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.listExams(actor);
  }

  @Get('questions')
  async listQuestions(
    @Headers('authorization') authorization: string | undefined,
    @Query(new ValidationPipe({ transform: true, whitelist: true })) query: ListQuestionsDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.listQuestions(actor, query);
  }

  @Get('questions/:id')
  async getQuestionDetail(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.getQuestionDetail(actor, id);
  }

  @Post('questions')
  async createQuestion(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: CreateQuestionDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.createQuestion(actor, body);
  }

  @Patch('questions/:id')
  async updateQuestion(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: UpdateQuestionDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.updateQuestion(actor, id, body);
  }

  @Patch('questions/:id/review')
  async updateReview(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: UpdateReviewDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.updateReview(actor, id, body);
  }

  @Post('questions/:id/notes')
  async createNote(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: CreateNoteDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.createNote(actor, id, body);
  }

  @Patch('notes/:noteId')
  async updateNote(
    @Headers('authorization') authorization: string | undefined,
    @Param('noteId', ParseIntPipe) noteId: number,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: UpdateNoteDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.updateNote(actor, noteId, body);
  }

  @Delete('notes/:noteId')
  async deleteNote(
    @Headers('authorization') authorization: string | undefined,
    @Param('noteId', ParseIntPipe) noteId: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.deleteNote(actor, noteId);
  }

  @Post('import/manual')
  async importManual(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: CreateQuestionDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.importManual(actor, body);
  }

  @Post('import/json')
  async importJson(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: ImportQuestionsDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.importJson(actor, body);
  }
}
