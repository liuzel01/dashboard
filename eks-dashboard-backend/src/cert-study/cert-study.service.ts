import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type * as mysql from 'mysql2/promise';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuthService } from '../auth/auth.service';
import { AccessControlService } from '../access-control/access-control.service';
import { ListQuestionsDto } from './dto/list-questions.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { ImportQuestionsDto } from './dto/import-questions.dto';

type ActorContext = {
  userId: number;
  username: string;
  permissions: string[];
  roles: string[];
};

type QuestionRecord = {
  id: number;
  exam_id: number;
  exam_code: string;
  source: string;
  source_url: string | null;
  source_question_no: string | null;
  source_topic: string | null;
  domain: string | null;
  stem: string;
  source_answer: string | null;
  explanation: string | null;
  raw_html: string | null;
  content_hash: string;
  created_at: string;
  updated_at: string;
  review_status: string | null;
  is_important: number | null;
  my_final_answer: string | null;
  confidence: string | null;
  review_count: number | null;
  wrong_count: number | null;
  correct_streak: number | null;
  last_result: string | null;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  tags_csv: string | null;
};

@Injectable()
export class CertStudyService {
  private readonly schemaRequirements: Record<string, string[]> = {
    cert_exams: ['id', 'code', 'name', 'provider', 'created_at', 'updated_at'],
    cert_questions: [
      'id',
      'exam_id',
      'source',
      'source_url',
      'source_question_no',
      'source_topic',
      'domain',
      'stem',
      'source_answer',
      'explanation',
      'raw_html',
      'content_hash',
      'created_at',
      'updated_at',
    ],
    cert_question_options: ['id', 'question_id', 'option_key', 'option_text', 'created_at', 'updated_at'],
    cert_question_reviews: [
      'id',
      'question_id',
      'user_id',
      'status',
      'is_important',
      'my_final_answer',
      'confidence',
      'review_count',
      'wrong_count',
      'correct_streak',
      'last_result',
      'last_reviewed_at',
      'next_review_at',
      'created_at',
      'updated_at',
    ],
    cert_question_notes: ['id', 'question_id', 'user_id', 'note_type', 'title', 'content', 'url', 'created_at', 'updated_at'],
    cert_question_tags: ['id', 'question_id', 'tag', 'created_at'],
    users: ['id', 'username'],
  };

  private schemaChecked = false;
  private schemaCheckingPromise: Promise<void> | null = null;
  private readonly listCacheTtlMs = 30_000;
  private readonly detailCacheTtlMs = 60_000;
  private readonly responseCache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly authService: AuthService,
    private readonly accessControl: AccessControlService,
  ) {}

  async resolveActorFromAuthorization(authorization?: string): Promise<ActorContext> {
    const auth = String(authorization || '');
    if (!auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = auth.slice(7).trim();
    const payload = await this.authService.verifyToken(token);

    let userId: number;
    if (payload.source === 'keycloak' || typeof payload.sub !== 'number') {
      const user = await this.accessControl.ensureUserByUsername(payload.username, {
        displayName: payload.displayName,
      });
      userId = user.id;
    } else {
      userId = Number(payload.sub);
    }

    const me = await this.accessControl.getMe({ userId });
    const actor: ActorContext = {
      userId: Number(me.id),
      username: String(me.username || payload.username || ''),
      permissions: Array.isArray(me.permissions) ? me.permissions.map((v: any) => String(v)) : [],
      roles: Array.isArray(me.roles)
        ? me.roles.map((role: any) => String(role?.name || role || '')).filter(Boolean)
        : [],
    };
    this.ensurePermissions(actor, ['menu:cert-study']);
    return actor;
  }

  async listExams(actor: ActorContext) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();
    await Promise.all(['SAP-C02', 'DOP-C02', 'SCS-C03'].map((code) => this.ensureExamByCode(code)));
    const rows = await this.db.query<any[]>(
      'SELECT id, code, name, provider, created_at, updated_at FROM cert_exams ORDER BY id ASC',
    );
    return { items: rows };
  }

  async listQuestions(actor: ActorContext, query: ListQuestionsDto) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();
    const examCode = this.normalizeExamCode(query.examCode);
    const exam = await this.ensureExamByCode(examCode);

    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const keyword = (query.keyword || '').trim();
    const status = (query.status || '').trim();
    const source = (query.source || '').trim();
    const tag = (query.tag || '').trim();
    const important = query.important;
    const reviewedOnly = query.reviewedOnly;
    const sortBy = (query.sortBy || '').trim();
    const sortOrder = (query.sortOrder || '').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const orderBySql =
      sortBy === 'reviewCount'
        ? `COALESCE(r.review_count, 0) ${sortOrder}, q.id ASC`
        : 'q.id ASC';

    const cacheKey = this.makeCacheKey('list', actor.userId, {
      examCode,
      page,
      pageSize,
      keyword,
      status,
      source,
      tag,
      important,
      reviewedOnly,
      sortBy,
      sortOrder,
    });
    const cached = this.getCachedResponse<Awaited<ReturnType<CertStudyService['listQuestions']>>>(cacheKey);
    if (cached) {
      return cached;
    }

    const wherePack = this.buildQuestionWhere({
      examId: exam.id,
      keyword,
      source,
      tag,
      important,
      reviewedOnly,
      status,
      includeStatus: true,
    });
    const summaryWherePack = this.buildQuestionWhere({
      examId: exam.id,
      keyword,
      source,
      tag,
      important,
      reviewedOnly,
      status,
      includeStatus: false,
    });
    const whereSql = wherePack.where.join(' AND ');

    const rows = await this.db.query<QuestionRecord[]>(
      `SELECT
         q.id,
         q.exam_id,
         e.code AS exam_code,
         q.source,
         q.source_url,
         q.source_question_no,
         q.source_topic,
         q.domain,
         q.stem,
         q.source_answer,
         q.explanation,
         q.raw_html,
         q.content_hash,
         q.created_at,
         q.updated_at,
         r.status AS review_status,
         r.is_important,
         r.my_final_answer,
         r.confidence,
         r.review_count,
         r.wrong_count,
         r.correct_streak,
         r.last_result,
         r.last_reviewed_at,
         r.next_review_at,
         tags.tags_csv
       FROM cert_questions q
       INNER JOIN cert_exams e ON e.id = q.exam_id
       ${this.buildLatestUserReviewJoinSql('r')}
       LEFT JOIN (
         SELECT question_id, GROUP_CONCAT(tag ORDER BY tag SEPARATOR '||') AS tags_csv
         FROM cert_question_tags
         GROUP BY question_id
       ) tags ON tags.question_id = q.id
       WHERE ${whereSql}
       ORDER BY ${orderBySql}
       LIMIT ? OFFSET ?`,
      [actor.userId, ...wherePack.params, pageSize, offset],
    );

    const countRows = await this.db.query<{ total: number }[]>(
      `SELECT COUNT(1) AS total
       FROM cert_questions q
       ${this.buildLatestUserReviewJoinSql('r')}
       WHERE ${whereSql}`,
      [actor.userId, ...wherePack.params],
    );

    const summaryRows = await this.db.query<{ status: string; total: number }[]>(
      `SELECT COALESCE(r.status, 'new') AS status, COUNT(1) AS total
       FROM cert_questions q
       ${this.buildLatestUserReviewJoinSql('r')}
       WHERE ${summaryWherePack.where.join(' AND ')}
       GROUP BY COALESCE(r.status, 'new')`,
      [actor.userId, ...summaryWherePack.params],
    );

    const tagRows = await this.db.query<{ tag: string }[]>(
      `SELECT DISTINCT t.tag
       FROM cert_question_tags t
       INNER JOIN cert_questions q ON q.id = t.question_id
       WHERE q.exam_id = ?
       ORDER BY t.tag ASC
       LIMIT 500`,
      [exam.id],
    );

    const statusSummary = summaryRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.total || 0);
      return acc;
    }, {});

    const response = {
      exam: { id: exam.id, code: exam.code, name: exam.name, provider: exam.provider },
      pagination: {
        page,
        pageSize,
        total: Number(countRows?.[0]?.total || 0),
      },
      statusSummary,
      availableTags: tagRows.map((row) => row.tag),
      items: rows.map((row) => this.mapListRow(row)),
    };
    this.setCachedResponse(cacheKey, response, this.listCacheTtlMs);
    return response;
  }

  async getQuestionDetail(actor: ActorContext, questionId: number) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();

    const cacheKey = this.makeCacheKey('detail', actor.userId, { questionId });
    const cached = this.getCachedResponse<Awaited<ReturnType<CertStudyService['getQuestionDetail']>>>(cacheKey);
    if (cached) {
      return cached;
    }

    const questionRows = await this.db.query<QuestionRecord[]>(
      `SELECT
         q.id,
         q.exam_id,
         e.code AS exam_code,
         q.source,
         q.source_url,
         q.source_question_no,
         q.source_topic,
         q.domain,
         q.stem,
         q.source_answer,
         q.explanation,
         q.raw_html,
         q.content_hash,
         q.created_at,
         q.updated_at,
         r.status AS review_status,
         r.is_important,
         r.my_final_answer,
         r.confidence,
         r.review_count,
         r.wrong_count,
         r.correct_streak,
         r.last_result,
         r.last_reviewed_at,
         r.next_review_at,
         tags.tags_csv
       FROM cert_questions q
       INNER JOIN cert_exams e ON e.id = q.exam_id
       ${this.buildLatestUserReviewJoinSql('r')}
       LEFT JOIN (
         SELECT question_id, GROUP_CONCAT(tag ORDER BY tag SEPARATOR '||') AS tags_csv
         FROM cert_question_tags
         GROUP BY question_id
       ) tags ON tags.question_id = q.id
       WHERE q.id = ?
       LIMIT 1`,
      [actor.userId, questionId],
    );

    const question = questionRows[0];
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    const options = await this.db.query<any[]>(
      `SELECT option_key, option_text
       FROM cert_question_options
       WHERE question_id = ?
       ORDER BY option_key ASC`,
      [questionId],
    );

    const notes = await this.db.query<any[]>(
      `SELECT id, question_id, user_id, note_type, title, content, url, created_at, updated_at
       FROM cert_question_notes
       WHERE question_id = ?
         AND (user_id = ? OR user_id IS NULL)
       ORDER BY updated_at DESC, id DESC`,
      [questionId, actor.userId],
    );

    const response = {
      question: this.mapListRow(question),
      options: options.map((row) => ({ key: row.option_key, text: row.option_text })),
      notes,
    };
    this.setCachedResponse(cacheKey, response, this.detailCacheTtlMs);
    return response;
  }

  async createQuestion(actor: ActorContext, dto: CreateQuestionDto) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();
    const examCode = this.normalizeExamCode(dto.examCode);
    const exam = await this.ensureExamByCode(examCode);
    const payload = this.normalizeQuestionPayload(dto);

    const result = await this.db.withTransaction(async (conn) => {
      const existing = await this.findQuestionByHash(conn, exam.id, payload.contentHash);
      if (existing) {
        await this.ensureReviewRow(conn, actor.userId, existing.id);
        return { created: false, questionId: Number(existing.id) };
      }

      const [insertResult] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO cert_questions (
           exam_id, source, source_url, source_question_no, source_topic, domain,
           stem, source_answer, explanation, raw_html, content_hash, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [
          exam.id,
          payload.source,
          payload.sourceUrl,
          payload.sourceQuestionNo,
          payload.sourceTopic,
          payload.domain,
          payload.stem,
          payload.sourceAnswer,
          payload.explanation,
          payload.rawHtml,
          payload.contentHash,
        ],
      );
      const questionId = Number(insertResult.insertId);
      await this.replaceQuestionOptions(conn, questionId, payload.options);
      await this.replaceQuestionTags(conn, questionId, payload.tags);
      await this.ensureReviewRow(conn, actor.userId, questionId);
      return { created: true, questionId };
    });

    this.clearResponseCache();
    return result;
  }

  async updateQuestion(actor: ActorContext, questionId: number, dto: UpdateQuestionDto) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();

    const current = await this.db.query<any[]>(
      `SELECT id, exam_id, source, source_url, source_question_no, source_topic, domain,
              stem, source_answer, explanation, raw_html
       FROM cert_questions
       WHERE id = ?
       LIMIT 1`,
      [questionId],
    );
    const row = current[0];
    if (!row) {
      throw new NotFoundException('Question not found');
    }

    const next = {
      source: dto.source ?? row.source,
      sourceUrl: dto.sourceUrl ?? row.source_url,
      sourceQuestionNo: dto.sourceQuestionNo ?? row.source_question_no,
      sourceTopic: dto.sourceTopic ?? row.source_topic,
      domain: dto.domain ?? row.domain,
      stem: dto.stem ?? row.stem,
      sourceAnswer: dto.sourceAnswer ?? row.source_answer,
      explanation: dto.explanation ?? row.explanation,
      rawHtml: dto.rawHtml ?? row.raw_html,
    };
    const options = dto.options ? this.normalizeOptions(dto.options) : null;
    const hashOptions =
      options ||
      (await this.db.query<Array<{ option_key: string; option_text: string }>>(
        `SELECT option_key, option_text
         FROM cert_question_options
         WHERE question_id = ?
         ORDER BY option_key ASC`,
        [questionId],
      )).map((item) => ({ key: item.option_key, text: item.option_text }));
    const tags = dto.tags ? this.normalizeTags(dto.tags) : null;
    const contentHash = this.buildContentHash(next.stem, hashOptions);

    await this.db.withTransaction(async (conn) => {
      const duplicate = await this.findQuestionByHash(conn, Number(row.exam_id), contentHash);
      if (duplicate && Number(duplicate.id) !== questionId) {
        throw new BadRequestException(`Duplicate question exists (id=${duplicate.id})`);
      }

      await conn.execute(
        `UPDATE cert_questions
         SET source = ?,
             source_url = ?,
             source_question_no = ?,
             source_topic = ?,
             domain = ?,
             stem = ?,
             source_answer = ?,
             explanation = ?,
             raw_html = ?,
             content_hash = ?,
             updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [
          next.source,
          next.sourceUrl,
          next.sourceQuestionNo,
          next.sourceTopic,
          next.domain,
          next.stem,
          next.sourceAnswer,
          next.explanation,
          next.rawHtml,
          contentHash,
          questionId,
        ],
      );

      if (options) {
        await this.replaceQuestionOptions(conn, questionId, options);
      }
      if (tags) {
        await this.replaceQuestionTags(conn, questionId, tags);
      }
    });

    this.clearResponseCache();
    return { ok: true, questionId };
  }

  async updateReview(actor: ActorContext, questionId: number, dto: UpdateReviewDto) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();
    await this.assertQuestionExists(questionId);

    return this.db.withTransaction(async (conn) => {
      const existingRows = await conn.execute<any[]>(
        `SELECT id, status, is_important, my_final_answer, confidence,
                review_count, wrong_count, correct_streak, last_result, last_reviewed_at, next_review_at
         FROM cert_question_reviews
         WHERE question_id = ? AND user_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [questionId, actor.userId],
      );
      const existing = (existingRows[0] as any[])[0];
      const nowResult = dto.lastResult ? String(dto.lastResult) : null;
      const previousReviewCount = Number(existing?.review_count || 0);
      const previousWrongCount = Number(existing?.wrong_count || 0);
      const previousCorrectStreak = Number(existing?.correct_streak || 0);

      const nextReviewCount = previousReviewCount + (nowResult ? 1 : 0);
      const nextWrongCount = previousWrongCount + (nowResult === 'wrong' ? 1 : 0);
      const nextCorrectStreak = nowResult
        ? nowResult === 'correct'
          ? previousCorrectStreak + 1
          : 0
        : previousCorrectStreak;

      const status = dto.status ?? existing?.status ?? 'new';
      const isImportant = dto.isImportant ?? Boolean(Number(existing?.is_important || 0));
      const myFinalAnswer = dto.myFinalAnswer ?? existing?.my_final_answer ?? null;
      const confidence = dto.confidence ?? existing?.confidence ?? null;
      const lastResult = nowResult ?? existing?.last_result ?? null;
      const nextReviewAt = dto.nextReviewAt === undefined ? existing?.next_review_at ?? null : dto.nextReviewAt;
      const shouldTouchLastReviewedAt = Boolean(nowResult);

      if (existing) {
        await conn.execute(
          `UPDATE cert_question_reviews
           SET status = ?,
               is_important = ?,
               my_final_answer = ?,
               confidence = ?,
               review_count = ?,
               wrong_count = ?,
               correct_streak = ?,
               last_result = ?,
               last_reviewed_at = ${shouldTouchLastReviewedAt ? 'UTC_TIMESTAMP()' : 'last_reviewed_at'},
               next_review_at = ?,
               updated_at = UTC_TIMESTAMP()
           WHERE id = ?`,
          [
            status,
            isImportant ? 1 : 0,
            myFinalAnswer,
            confidence,
            nextReviewCount,
            nextWrongCount,
            nextCorrectStreak,
            lastResult,
            nextReviewAt,
            existing.id,
          ],
        );
      } else {
        await conn.execute(
          `INSERT INTO cert_question_reviews (
             question_id, user_id, status, is_important, my_final_answer, confidence,
             review_count, wrong_count, correct_streak, last_result, last_reviewed_at, next_review_at,
             created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${shouldTouchLastReviewedAt ? 'UTC_TIMESTAMP()' : 'NULL'}, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP()
           )`,
          [
            questionId,
            actor.userId,
            status,
            isImportant ? 1 : 0,
            myFinalAnswer,
            confidence,
            nextReviewCount,
            nextWrongCount,
            nextCorrectStreak,
            lastResult,
            nextReviewAt,
          ],
        );
      }
      this.clearResponseCache();
      return {
        ok: true,
        review: {
          status,
          is_important: isImportant ? 1 : 0,
          my_final_answer: myFinalAnswer,
          confidence,
          review_count: nextReviewCount,
          wrong_count: nextWrongCount,
          correct_streak: nextCorrectStreak,
          last_result: lastResult,
          next_review_at: nextReviewAt,
        },
      };
    });
  }

  async createNote(actor: ActorContext, questionId: number, dto: CreateNoteDto) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();
    await this.assertQuestionExists(questionId);
    const noteType = String(dto.noteType || '').trim();
    if (!noteType) {
      throw new BadRequestException('noteType is required');
    }

    const result = await this.db.query<mysql.ResultSetHeader>(
      `INSERT INTO cert_question_notes (
         question_id, user_id, note_type, title, content, url, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        questionId,
        actor.userId,
        noteType,
        this.nullableTrim(dto.title),
        String(dto.content || ''),
        this.nullableTrim(dto.url),
      ],
    );
    this.clearResponseCache();
    return { ok: true, noteId: Number(result.insertId) };
  }

  async updateNote(actor: ActorContext, noteId: number, dto: UpdateNoteDto) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();

    const notes = await this.db.query<any[]>(
      'SELECT id, user_id FROM cert_question_notes WHERE id = ? LIMIT 1',
      [noteId],
    );
    const note = notes[0];
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    if (note.user_id !== null && Number(note.user_id) !== actor.userId) {
      throw new ForbiddenException('Cannot edit note from another user');
    }

    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    if (dto.noteType !== undefined) {
      fields.push('note_type = ?');
      values.push(String(dto.noteType).trim());
    }
    if (dto.title !== undefined) {
      fields.push('title = ?');
      values.push(this.nullableTrim(dto.title));
    }
    if (dto.content !== undefined) {
      fields.push('content = ?');
      values.push(String(dto.content));
    }
    if (dto.url !== undefined) {
      fields.push('url = ?');
      values.push(this.nullableTrim(dto.url));
    }
    if (fields.length === 0) {
      return { ok: true, noteId };
    }
    values.push(noteId);

    await this.db.query(
      `UPDATE cert_question_notes SET ${fields.join(', ')}, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      values,
    );
    this.clearResponseCache();
    return { ok: true, noteId };
  }

  async deleteNote(actor: ActorContext, noteId: number) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();
    const notes = await this.db.query<any[]>(
      'SELECT id, user_id FROM cert_question_notes WHERE id = ? LIMIT 1',
      [noteId],
    );
    const note = notes[0];
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    if (note.user_id !== null && Number(note.user_id) !== actor.userId) {
      throw new ForbiddenException('Cannot delete note from another user');
    }

    await this.db.query('DELETE FROM cert_question_notes WHERE id = ?', [noteId]);
    this.clearResponseCache();
    return { ok: true, noteId };
  }

  async importManual(actor: ActorContext, dto: CreateQuestionDto) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();
    const result = await this.createQuestion(actor, dto);
    return {
      total: 1,
      imported: result.created ? 1 : 0,
      duplicated: result.created ? 0 : 1,
      failed: 0,
      items: [{ index: 0, questionId: result.questionId, created: result.created }],
    };
  }

  async importJson(actor: ActorContext, dto: ImportQuestionsDto) {
    this.ensurePermissions(actor, ['menu:cert-study']);
    await this.ensureSchema();

    const items = Array.isArray(dto.items) ? dto.items : [];
    const resultItems: Array<{ index: number; questionId?: number; created?: boolean; error?: string }> =
      [];
    let imported = 0;
    let duplicated = 0;
    let failed = 0;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      try {
        const result = await this.createQuestion(actor, item);
        if (result.created) imported += 1;
        else duplicated += 1;
        resultItems.push({ index, questionId: result.questionId, created: result.created });
      } catch (error: any) {
        failed += 1;
        resultItems.push({ index, error: this.errorMessage(error) });
      }
    }

    return {
      total: items.length,
      imported,
      duplicated,
      failed,
      items: resultItems,
    };
  }

  private normalizeExamCode(examCode?: string) {
    return String(examCode || 'SAP-C02')
      .trim()
      .toUpperCase();
  }

  private getExamMetadata(examCode: string) {
    const normalizedCode = this.normalizeExamCode(examCode);
    const catalog: Record<string, { name: string; provider: string }> = {
      'SAP-C02': {
        name: 'AWS Certified Solutions Architect - Professional',
        provider: 'aws',
      },
      'DOP-C02': {
        name: 'AWS Certified DevOps Engineer - Professional',
        provider: 'aws',
      },
      'SCS-C03': {
        name: 'AWS Certified Security - Specialty',
        provider: 'aws',
      },
    };
    return catalog[normalizedCode] || { name: normalizedCode, provider: 'aws' };
  }

  private makeCacheKey(scope: string, userId: number, payload: Record<string, unknown>) {
    return `${scope}:${userId}:${JSON.stringify(payload)}`;
  }

  private getCachedResponse<T>(key: string): T | null {
    const item = this.responseCache.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.responseCache.delete(key);
      return null;
    }
    return item.value as T;
  }

  private setCachedResponse<T>(key: string, value: T, ttlMs: number) {
    this.responseCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  }

  private clearResponseCache() {
    this.responseCache.clear();
  }

  private ensurePermissions(actor: ActorContext, required: string[]) {
    const missing = required.filter((key) => !actor.permissions.includes(key));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permissions: ${missing.join(', ')}`);
    }
  }

  private async ensureSchema() {
    if (this.schemaChecked) return;
    if (this.schemaCheckingPromise) {
      await this.schemaCheckingPromise;
      return;
    }
    this.schemaCheckingPromise = this.checkSchema().finally(() => {
      this.schemaCheckingPromise = null;
    });
    await this.schemaCheckingPromise;
    this.schemaChecked = true;
  }

  private async checkSchema() {
    for (const [table, requiredColumns] of Object.entries(this.schemaRequirements)) {
      let rows: Array<{ Field: string }> = [];
      try {
        rows = await this.db.query<Array<{ Field: string }>>(`SHOW COLUMNS FROM ${table}`);
      } catch (error: any) {
        throw new BadRequestException(
          `Schema mismatch: table "${table}" is missing or inaccessible (${this.errorMessage(error)}). Please apply DB changes manually.`,
        );
      }
      const actual = new Set(rows.map((row) => row.Field));
      const missingColumns = requiredColumns.filter((column) => !actual.has(column));
      if (missingColumns.length > 0) {
        throw new BadRequestException(
          `Schema mismatch: table "${table}" is missing columns: ${missingColumns.join(', ')}. Please apply DB changes manually.`,
        );
      }
    }
  }

  private async ensureExamByCode(code: string) {
    const normalizedCode = this.normalizeExamCode(code);
    const metadata = this.getExamMetadata(normalizedCode);
    await this.db.query(
      `INSERT INTO cert_exams (code, name, provider, created_at, updated_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE name = VALUES(name), provider = VALUES(provider), updated_at = UTC_TIMESTAMP()`,
      [normalizedCode, metadata.name, metadata.provider],
    );
    const rows = await this.db.query<any[]>(
      'SELECT id, code, name, provider FROM cert_exams WHERE code = ? LIMIT 1',
      [normalizedCode],
    );
    const exam = rows[0];
    if (!exam) {
      throw new BadRequestException(`Exam not found: ${normalizedCode}`);
    }
    return exam;
  }

  private mapListRow(row: QuestionRecord) {
    return {
      id: Number(row.id),
      examCode: row.exam_code,
      source: row.source,
      sourceUrl: row.source_url,
      sourceQuestionNo: row.source_question_no,
      sourceTopic: row.source_topic,
      domain: row.domain,
      stem: row.stem,
      sourceAnswer: row.source_answer,
      explanation: row.explanation,
      rawHtml: row.raw_html,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      review: {
        status: row.review_status || 'new',
        isImportant: Number(row.is_important || 0) === 1,
        myFinalAnswer: row.my_final_answer,
        confidence: row.confidence,
        reviewCount: Number(row.review_count || 0),
        wrongCount: Number(row.wrong_count || 0),
        correctStreak: Number(row.correct_streak || 0),
        lastResult: row.last_result,
        lastReviewedAt: row.last_reviewed_at,
        nextReviewAt: row.next_review_at,
      },
      tags: this.parseTags(row.tags_csv),
    };
  }

  private parseTags(tagsCsv: string | null) {
    if (!tagsCsv) return [];
    return String(tagsCsv)
      .split('||')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  private buildLatestUserReviewJoinSql(reviewAlias: string) {
    return `LEFT JOIN (
         SELECT rr.*
         FROM cert_question_reviews rr
         INNER JOIN (
           SELECT question_id, MAX(id) AS latest_id
           FROM cert_question_reviews
           WHERE user_id = ?
           GROUP BY question_id
         ) latest ON latest.latest_id = rr.id
       ) ${reviewAlias} ON ${reviewAlias}.question_id = q.id`;
  }

  private buildQuestionWhere(input: {
    examId: number;
    keyword: string;
    source: string;
    tag: string;
    important?: number;
    reviewedOnly?: number;
    status: string;
    includeStatus: boolean;
  }) {
    const where: string[] = ['q.exam_id = ?'];
    const params: Array<string | number> = [input.examId];

    if (input.keyword) {
      where.push('(q.stem LIKE ? OR q.source_question_no LIKE ? OR q.domain LIKE ?)');
      const pattern = `%${input.keyword}%`;
      params.push(pattern, pattern, pattern);
    }
    if (input.source) {
      where.push('q.source = ?');
      params.push(input.source);
    }
    if (input.tag) {
      where.push(
        'EXISTS (SELECT 1 FROM cert_question_tags t2 WHERE t2.question_id = q.id AND t2.tag = ?)',
      );
      params.push(input.tag);
    }
    if (typeof input.important === 'number') {
      where.push('COALESCE(r.is_important, 0) = ?');
      params.push(input.important);
    }
    if (input.reviewedOnly === 1) {
      where.push('COALESCE(r.review_count, 0) > 0');
    }
    if (input.includeStatus && input.status) {
      where.push("COALESCE(r.status, 'new') = ?");
      params.push(input.status);
    } else if (input.includeStatus) {
      where.push("COALESCE(r.status, 'new') <> 'archived'");
    }
    return { where, params };
  }

  private normalizeQuestionPayload(dto: CreateQuestionDto) {
    const stem = String(dto.stem || '').trim();
    if (!stem) throw new BadRequestException('stem is required');
    const source = String(dto.source || '').trim();
    if (!source) throw new BadRequestException('source is required');
    const options = this.normalizeOptions(dto.options);
    if (options.length === 0) throw new BadRequestException('At least one option is required');
    const tags = this.normalizeTags(dto.tags);
    const contentHash = this.buildContentHash(stem, options);

    return {
      source,
      sourceUrl: this.nullableTrim(dto.sourceUrl),
      sourceQuestionNo: this.nullableTrim(dto.sourceQuestionNo),
      sourceTopic: this.nullableTrim(dto.sourceTopic),
      domain: this.nullableTrim(dto.domain),
      stem,
      sourceAnswer: this.nullableTrim(dto.sourceAnswer),
      explanation: this.nullableTrim(dto.explanation),
      rawHtml: this.nullableTrim(dto.rawHtml),
      options,
      tags,
      contentHash,
    };
  }

  private normalizeOptions(optionsInput: Record<string, string>) {
    if (!optionsInput || typeof optionsInput !== 'object' || Array.isArray(optionsInput)) {
      throw new BadRequestException('options must be an object like {"A":"...", "B":"..."}');
    }
    const options = Object.entries(optionsInput)
      .map(([key, text]) => ({
        key: String(key || '').trim().toUpperCase(),
        text: String(text || '').trim(),
      }))
      .filter((item) => item.key && item.text);
    if (options.length === 0) {
      throw new BadRequestException('options cannot be empty');
    }
    options.sort((a, b) => a.key.localeCompare(b.key));
    return options;
  }

  private normalizeTags(tagsInput?: string[]) {
    if (!Array.isArray(tagsInput)) return [];
    return Array.from(
      new Set(
        tagsInput
          .map((tag) => String(tag || '').trim())
          .filter(Boolean),
      ),
    ).slice(0, 64);
  }

  private buildContentHash(stem: string, options?: Array<{ key: string; text: string }>) {
    const normalizedStem = stem.trim().replace(/\s+/g, ' ');
    const optionsPayload = (options || [])
      .map((opt) => `${opt.key}:${opt.text.trim().replace(/\s+/g, ' ')}`)
      .join('|');
    return crypto.createHash('sha256').update(`${normalizedStem}||${optionsPayload}`).digest('hex');
  }

  private async findQuestionByHash(
    conn: mysql.PoolConnection,
    examId: number,
    contentHash: string,
  ): Promise<{ id: number } | null> {
    const [rows] = await conn.execute<any[]>(
      'SELECT id FROM cert_questions WHERE exam_id = ? AND content_hash = ? LIMIT 1',
      [examId, contentHash],
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? { id: Number(row.id) } : null;
  }

  private async replaceQuestionOptions(
    conn: mysql.PoolConnection,
    questionId: number,
    options: Array<{ key: string; text: string }>,
  ) {
    await conn.execute('DELETE FROM cert_question_options WHERE question_id = ?', [questionId]);
    for (const option of options) {
      await conn.execute(
        `INSERT INTO cert_question_options (
           question_id, option_key, option_text, created_at, updated_at
         ) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [questionId, option.key, option.text],
      );
    }
  }

  private async replaceQuestionTags(
    conn: mysql.PoolConnection,
    questionId: number,
    tags: string[],
  ) {
    await conn.execute('DELETE FROM cert_question_tags WHERE question_id = ?', [questionId]);
    for (const tag of tags) {
      await conn.execute(
        'INSERT INTO cert_question_tags (question_id, tag, created_at) VALUES (?, ?, UTC_TIMESTAMP())',
        [questionId, tag],
      );
    }
  }

  private async ensureReviewRow(conn: mysql.PoolConnection, userId: number, questionId: number) {
    const [rows] = await conn.execute<any[]>(
      'SELECT id FROM cert_question_reviews WHERE question_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
      [questionId, userId],
    );
    if (Array.isArray(rows) && rows.length > 0) return;
    await conn.execute(
      `INSERT INTO cert_question_reviews (
         question_id, user_id, status, is_important, review_count, wrong_count, correct_streak,
         created_at, updated_at
       ) VALUES (?, ?, 'new', 0, 0, 0, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [questionId, userId],
    );
  }

  private async assertQuestionExists(questionId: number) {
    const rows = await this.db.query<any[]>(
      'SELECT id FROM cert_questions WHERE id = ? LIMIT 1',
      [questionId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Question not found');
    }
  }

  private nullableTrim(value?: string | null) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
  }

  private errorMessage(error: any) {
    if (!error) return 'Unknown error';
    if (typeof error?.response?.data?.message === 'string') {
      return error.response.data.message;
    }
    if (typeof error?.message === 'string') return error.message;
    return String(error);
  }
}
