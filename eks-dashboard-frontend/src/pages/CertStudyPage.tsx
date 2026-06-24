import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Checkbox,
  Collapse,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  createCertStudyNote,
  deleteCertStudyNote,
  getCertStudyQuestionDetail,
  getCertStudyQuestions,
  importCertStudyJson,
  importCertStudyManual,
  updateCertStudyNote,
  updateCertStudyReview,
} from '../services/api';
import type { CertStudyQuestionListItem, CertStudyQuestionNote } from '../services/api';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

type QuestionDetailState = {
  question: CertStudyQuestionListItem;
  options: Array<{ key: string; text: string }>;
  notes: CertStudyQuestionNote[];
};

type CertStudyColumnKey = 'id' | 'sourceQuestionNo' | 'stem' | 'source' | 'domain' | 'status' | 'important' | 'tags' | 'reviewStats' | 'actions';

const columnOptions: Array<{ label: string; value: CertStudyColumnKey }> = [
  { label: 'ID', value: 'id' },
  { label: '题号', value: 'sourceQuestionNo' },
  { label: '题干', value: 'stem' },
  { label: '来源', value: 'source' },
  { label: 'Domain', value: 'domain' },
  { label: '状态', value: 'status' },
  { label: '重点', value: 'important' },
  { label: '标签', value: 'tags' },
  { label: '复/错', value: 'reviewStats' },
];

const defaultVisibleColumns: CertStudyColumnKey[] = [
  'sourceQuestionNo',
  'stem',
  'source',
  'status',
  'important',
  'tags',
  'actions',
];


const CERT_STUDY_VISIBLE_COLUMNS_STORAGE_KEY = 'cert-study.visibleColumns.v1';
const validColumnKeys = new Set<CertStudyColumnKey>([
  ...columnOptions.map((item) => item.value),
  'actions',
]);

const normalizeVisibleColumns = (values: unknown): CertStudyColumnKey[] => {
  if (!Array.isArray(values)) return defaultVisibleColumns;
  const next = values.filter((item): item is CertStudyColumnKey =>
    typeof item === 'string' && validColumnKeys.has(item as CertStudyColumnKey),
  );
  const unique = Array.from(new Set<CertStudyColumnKey>([...next, 'actions']));
  return unique.length > 1 ? unique : defaultVisibleColumns;
};

const loadVisibleColumns = (): CertStudyColumnKey[] => {
  if (typeof window === 'undefined') return defaultVisibleColumns;
  try {
    const raw = window.localStorage.getItem(CERT_STUDY_VISIBLE_COLUMNS_STORAGE_KEY);
    if (!raw) return defaultVisibleColumns;
    return normalizeVisibleColumns(JSON.parse(raw));
  } catch {
    return defaultVisibleColumns;
  }
};

const statusOptions = [
  { value: 'new', label: '未开始' },
  { value: 'reviewing', label: '复习中' },
  { value: 'uncertain', label: '不确定' },
  { value: 'mastered', label: '已掌握' },
  { value: 'archived', label: '已归档' },
];

const reviewSortOptions = [
  { value: 'default', label: '默认排序' },
  { value: 'reviewCountDesc', label: '按复习次数降序' },
  { value: 'reviewCountAsc', label: '按复习次数升序' },
];

const lastResultOptions = [
  { value: 'correct', label: '答对' },
  { value: 'wrong', label: '答错' },
  { value: 'uncertain', label: '不确定' },
  { value: 'skipped', label: '跳过' },
];

const DEFAULT_NOTE_TYPE = 'ai_explanation';

const noteTypeOptions = [
  { value: 'personal_note', label: '个人备注' },
  { value: 'ai_explanation', label: 'AI解释' },
  { value: 'aws_doc', label: 'AWS 文档' },
  { value: 'wrong_reason', label: '错题原因' },
  { value: 'option_analysis', label: '选项分析' },
  { value: 'discussion', label: '讨论摘要' },
];

const escapeHtml = (input: string) =>
  input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const renderInlineMarkdown = (text: string) => {
  let output = escapeHtml(text);
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_full, label, rawUrl) => {
    const url = String(rawUrl || '').trim();
    const safeUrl = /^https?:\/\//i.test(url) ? escapeHtml(url) : '#';
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return output;
};

const markdownToHtml = (markdown: string) => {
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n');
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const buffer: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        buffer.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && lines[index].startsWith('```')) {
        index += 1;
      }
      blocks.push(`<pre><code>${escapeHtml(buffer.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      blocks.push(
        `<ul>${items
          .map((item) => `<li>${renderInlineMarkdown(item)}</li>`)
          .join('')}</ul>`,
      );
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${paragraphLines.map((item) => renderInlineMarkdown(item)).join('<br/>')}</p>`);
  }
  return blocks.join('');
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(/\//g, '-');
};

const parseOptionsFromText = (text: string) => {
  const map: Record<string, string> = {};
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9]{1,8})\s*[:.、]\s*(.+)$/);
    if (!match) {
      throw new Error(`无效选项格式：${line}`);
    }
    map[match[1].toUpperCase()] = match[2].trim();
  }
  if (Object.keys(map).length === 0) {
    throw new Error('至少需要一个选项');
  }
  return map;
};

const CertStudyPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CertStudyQuestionListItem[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [statusSummary, setStatusSummary] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [important, setImportant] = useState<boolean>(false);
  const [reviewedOnly, setReviewedOnly] = useState<boolean>(false);
  const [reviewSort, setReviewSort] = useState<'default' | 'reviewCountDesc' | 'reviewCountAsc'>('default');
  const [source, setSource] = useState<string | undefined>(undefined);
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<QuestionDetailState | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [activeImportTab, setActiveImportTab] = useState<'manual' | 'json'>('manual');
  const [importing, setImporting] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteOpen, setEditNoteOpen] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const [savingEditedNote, setSavingEditedNote] = useState(false);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [detailNavLoading, setDetailNavLoading] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<CertStudyColumnKey[]>(loadVisibleColumns);

  const [reviewForm] = Form.useForm();
  const [noteForm] = Form.useForm();
  const [editNoteForm] = Form.useForm();
  const [manualImportForm] = Form.useForm();
  const [jsonImportForm] = Form.useForm();

  useEffect(() => {
    window.localStorage.setItem(
      CERT_STUDY_VISIBLE_COLUMNS_STORAGE_KEY,
      JSON.stringify(visibleColumns),
    );
  }, [visibleColumns]);

  const buildQuestionListParams = useCallback(
    (targetPage: number, targetPageSize = pageSize) => {
      const sortBy: 'reviewCount' | undefined =
        reviewSort === 'default' ? undefined : 'reviewCount';
      const sortOrder: 'asc' | 'desc' | undefined =
        reviewSort === 'reviewCountAsc'
          ? 'asc'
          : reviewSort === 'reviewCountDesc'
            ? 'desc'
            : undefined;
      return {
        examCode: 'SAP-C02',
        keyword: keyword.trim() || undefined,
        status,
        important: important ? 1 as const : undefined,
        reviewedOnly: reviewedOnly ? 1 as const : undefined,
        source,
        tag,
        sortBy,
        sortOrder,
        page: targetPage,
        pageSize: targetPageSize,
      };
    },
    [important, keyword, pageSize, reviewSort, reviewedOnly, source, status, tag],
  );

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCertStudyQuestions(buildQuestionListParams(page));
      setItems(response.items || []);
      setAvailableTags(response.availableTags || []);
      setStatusSummary(response.statusSummary || {});
      setTotal(Number(response.pagination?.total || 0));
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '加载题目失败');
    } finally {
      setLoading(false);
    }
  }, [buildQuestionListParams, message, page]);

  const loadQuestionDetail = useCallback(
    async (questionId: number) => {
      setDetailLoading(true);
      try {
        const response = await getCertStudyQuestionDetail(questionId);
        const nextDetail: QuestionDetailState = {
          question: response.question,
          options: response.options || [],
          notes: response.notes || [],
        };
        setDetail(nextDetail);
        setNoteComposerOpen(nextDetail.notes.length === 0);
        reviewForm.setFieldsValue({
          status: nextDetail.question.review.status,
          isImportant: nextDetail.question.review.isImportant,
          myFinalAnswer: nextDetail.question.review.myFinalAnswer || undefined,
          confidence: nextDetail.question.review.confidence || undefined,
          lastResult: undefined,
          nextReviewAt: nextDetail.question.review.nextReviewAt
            ? dayjs(nextDetail.question.review.nextReviewAt)
            : null,
        });
      } catch (error) {
        const err = error as { response?: { data?: { message?: string } }; message?: string };
        message.error(err?.response?.data?.message || err?.message || '加载题目详情失败');
      } finally {
        setDetailLoading(false);
      }
    },
    [message, reviewForm],
  );

  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions]);

  const openDetail = async (questionId: number) => {
    setSelectedId(questionId);
    setDetailOpen(true);
    setShowAnswer(false);
    await loadQuestionDetail(questionId);
  };

  const currentDetailIndex = selectedId === null ? -1 : items.findIndex((item) => item.id === selectedId);
  const hasPreviousDetail = currentDetailIndex > 0 || page > 1;
  const hasNextDetail =
    currentDetailIndex >= 0 && (currentDetailIndex < items.length - 1 || page * pageSize < total);

  const handleNavigateDetail = async (direction: 'previous' | 'next') => {
    if (detailNavLoading || detailLoading || selectedId === null) return;

    const currentIndex = items.findIndex((item) => item.id === selectedId);
    if (currentIndex < 0) return;

    let targetQuestion: CertStudyQuestionListItem | undefined;
    let targetPage = page;

    if (direction === 'previous') {
      if (currentIndex > 0) {
        targetQuestion = items[currentIndex - 1];
      } else if (page > 1) {
        targetPage = page - 1;
      }
    } else if (currentIndex < items.length - 1) {
      targetQuestion = items[currentIndex + 1];
    } else if (page * pageSize < total) {
      targetPage = page + 1;
    }

    setDetailNavLoading(true);
    try {
      if (!targetQuestion && targetPage !== page) {
        const response = await getCertStudyQuestions(buildQuestionListParams(targetPage));
        const nextItems = response.items || [];
        targetQuestion = direction === 'previous' ? nextItems[nextItems.length - 1] : nextItems[0];
        setItems(nextItems);
        setAvailableTags(response.availableTags || []);
        setStatusSummary(response.statusSummary || {});
        setTotal(Number(response.pagination?.total || 0));
        setPage(targetPage);
      }

      if (!targetQuestion) return;
      setSelectedId(targetQuestion.id);
      setShowAnswer(false);
      await loadQuestionDetail(targetQuestion.id);
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '切换题目失败');
    } finally {
      setDetailNavLoading(false);
    }
  };

  const handleSaveReview = async () => {
    if (!selectedId || savingReview) return;
    const values = await reviewForm.validateFields();
    setSavingReview(true);
    try {
      await updateCertStudyReview(selectedId, {
        status: values.status,
        isImportant: values.isImportant,
        myFinalAnswer: values.myFinalAnswer?.trim() || undefined,
        confidence: values.confidence,
        lastResult: values.lastResult,
        nextReviewAt: values.nextReviewAt ? dayjs(values.nextReviewAt).toISOString() : null,
      });
      const refreshedDetail = await getCertStudyQuestionDetail(selectedId);
      const nextDetail: QuestionDetailState = {
        question: refreshedDetail.question,
        options: refreshedDetail.options || [],
        notes: refreshedDetail.notes || [],
      };
      setDetail(nextDetail);
      setItems((prev) =>
        prev.map((item) => (item.id === selectedId ? nextDetail.question : item)),
      );
      message.success('复习状态已更新');
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '复习状态更新失败');
    } finally {
      setSavingReview(false);
    }
  };

  const handleQuickToggleImportant = async (row: CertStudyQuestionListItem) => {
    try {
      await updateCertStudyReview(row.id, {
        isImportant: !row.review.isImportant,
      });
      message.success('已更新重点标记');
      await loadQuestions();
      if (selectedId === row.id && detailOpen) {
        await loadQuestionDetail(row.id);
      }
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '重点标记更新失败');
    }
  };

  const handleArchive = async (row: CertStudyQuestionListItem) => {
    try {
      await updateCertStudyReview(row.id, {
        status: 'archived',
      });
      message.success('题目已归档');
      await loadQuestions();
      if (selectedId === row.id && detailOpen) {
        await loadQuestionDetail(row.id);
      }
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '归档失败');
    }
  };

  const handleAddNote = async () => {
    if (!selectedId || addingNote) return;
    const values = await noteForm.validateFields();
    setAddingNote(true);
    try {
      await createCertStudyNote(selectedId, {
        noteType: values.noteType,
        title: values.title?.trim() || undefined,
        content: values.content,
        url: values.url?.trim() || undefined,
      });
      noteForm.resetFields();
      noteForm.setFieldValue('noteType', DEFAULT_NOTE_TYPE);
      const refreshedDetail = await getCertStudyQuestionDetail(selectedId);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              notes: refreshedDetail.notes || [],
              question: refreshedDetail.question || prev.question,
              options: refreshedDetail.options || prev.options,
            }
          : prev,
      );
      setNoteComposerOpen(false);
      message.success('备注已添加');
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '添加备注失败');
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    try {
      await deleteCertStudyNote(noteId);
      if (selectedId) {
        const refreshedDetail = await getCertStudyQuestionDetail(selectedId);
        const refreshedNotes = refreshedDetail.notes || [];
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                notes: refreshedNotes,
                question: refreshedDetail.question || prev.question,
                options: refreshedDetail.options || prev.options,
              }
            : prev,
        );
        setNoteComposerOpen(refreshedNotes.length === 0);
      }
      message.success('备注已删除');
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '删除备注失败');
    }
  };

  const handleOpenEditNote = (note: CertStudyQuestionNote) => {
    setEditingNoteId(note.id);
    editNoteForm.setFieldsValue({
      noteType: note.note_type,
      title: note.title || undefined,
      content: note.content,
      url: note.url || undefined,
    });
    setEditNoteOpen(true);
  };

  const handleSaveEditedNote = async () => {
    if (!editingNoteId || savingEditedNote) return;
    const values = await editNoteForm.validateFields();
    setSavingEditedNote(true);
    try {
      await updateCertStudyNote(editingNoteId, {
        noteType: values.noteType,
        title: values.title?.trim() || undefined,
        content: values.content,
        url: values.url?.trim() || undefined,
      });
      message.success('备注已更新');
      setEditNoteOpen(false);
      setEditingNoteId(null);
      editNoteForm.resetFields();
      if (selectedId) {
        const refreshedDetail = await getCertStudyQuestionDetail(selectedId);
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                notes: refreshedDetail.notes || [],
                question: refreshedDetail.question || prev.question,
                options: refreshedDetail.options || prev.options,
              }
            : prev,
        );
      }
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '更新备注失败');
    } finally {
      setSavingEditedNote(false);
    }
  };

  const handleSubmitManualImport = async () => {
    const values = await manualImportForm.validateFields();
    let options: Record<string, string>;
    try {
      options = parseOptionsFromText(values.optionsText);
    } catch (error) {
      const err = error as { message?: string };
      message.error(err.message || '解析选项失败');
      return;
    }
    setImporting(true);
    try {
      const result = await importCertStudyManual({
        examCode: 'SAP-C02',
        source: values.source?.trim() || 'manual',
        sourceUrl: values.sourceUrl?.trim() || undefined,
        sourceQuestionNo: values.sourceQuestionNo?.trim() || undefined,
        sourceTopic: values.sourceTopic?.trim() || undefined,
        domain: values.domain?.trim() || undefined,
        stem: values.stem,
        options,
        sourceAnswer: values.sourceAnswer?.trim() || undefined,
        explanation: values.explanation?.trim() || undefined,
        tags: String(values.tags || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      });
      message.success(
        `导入完成：成功 ${result.imported}，重复 ${result.duplicated}，失败 ${result.failed}`,
      );
      manualImportForm.resetFields();
      setImportOpen(false);
      await loadQuestions();
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '手动导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleSubmitJsonImport = async () => {
    const values = await jsonImportForm.validateFields();
    let payload: unknown;
    try {
      payload = JSON.parse(values.jsonText);
    } catch {
      message.error('JSON 解析失败');
      return;
    }
    if (!Array.isArray(payload)) {
      message.error('JSON 顶层必须是数组');
      return;
    }
    setImporting(true);
    try {
      const result = await importCertStudyJson(payload as Array<Record<string, unknown>> as Array<{
        examCode?: string;
        source: string;
        sourceUrl?: string;
        sourceQuestionNo?: string;
        sourceTopic?: string;
        domain?: string;
        stem: string;
        options: Record<string, string>;
        sourceAnswer?: string;
        explanation?: string;
        rawHtml?: string;
        tags?: string[];
      }>);
      message.success(
        `导入完成：成功 ${result.imported}，重复 ${result.duplicated}，失败 ${result.failed}`,
      );
      setImportOpen(false);
      await loadQuestions();
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || 'JSON 导入失败');
    } finally {
      setImporting(false);
    }
  };

  const columns: ColumnsType<CertStudyQuestionListItem> = useMemo(
    () => {
      const allColumns: Array<ColumnsType<CertStudyQuestionListItem>[number] & { columnKey: CertStudyColumnKey }> = [
      {
        columnKey: 'id',
        title: 'ID',
        dataIndex: 'id',
        width: 72,
        fixed: 'left',
      },
      {
        columnKey: 'sourceQuestionNo',
        title: '题号',
        dataIndex: 'sourceQuestionNo',
        width: 88,
        render: (value: string | null) => value || '-',
      },
      {
        columnKey: 'stem',
        title: '题干',
        dataIndex: 'stem',
        minWidth: 520,
        render: (value: string) => (
          <Paragraph ellipsis={{ rows: 3, expandable: false }} style={{ marginBottom: 0 }}>
            {value}
          </Paragraph>
        ),
      },
      {
        columnKey: 'source',
        title: '来源',
        dataIndex: 'source',
        width: 88,
        ellipsis: true,
      },
      {
        columnKey: 'domain',
        title: 'Domain',
        dataIndex: 'domain',
        width: 120,
        ellipsis: true,
        render: (value: string | null) => value || '-',
      },
      {
        columnKey: 'status',
        title: '状态',
        width: 92,
        render: (_unused, row) => {
          const color =
            row.review.status === 'mastered'
              ? 'green'
              : row.review.status === 'uncertain'
                ? 'orange'
                : row.review.status === 'archived'
                  ? 'default'
                  : 'blue';
          return <Tag color={color}>{row.review.status || 'new'}</Tag>;
        },
      },
      {
        columnKey: 'important',
        title: '重点',
        width: 80,
        render: (_unused, row) =>
          row.review.isImportant ? <Tag color="red">重点</Tag> : <Text type="secondary">-</Text>,
      },
      {
        columnKey: 'tags',
        title: '标签',
        width: 132,
        render: (_unused, row) => (
          <Space size={[4, 4]} wrap>
            {row.tags.slice(0, 2).map((item) => (
              <Tag key={`${row.id}-${item}`}>{item}</Tag>
            ))}
            {row.tags.length > 2 ? <Tag>{`+${row.tags.length - 2}`}</Tag> : null}
          </Space>
        ),
      },
      {
        key: 'reviewStats',
        columnKey: 'reviewStats',
        title: '复/错',
        width: 82,
        sorter: true,
        sortOrder:
          reviewSort === 'reviewCountDesc'
            ? 'descend'
            : reviewSort === 'reviewCountAsc'
              ? 'ascend'
              : null,
        render: (_unused, row) => `${row.review.reviewCount}/${row.review.wrongCount}`,
      },
      {
        columnKey: 'actions',
        title: '操作',
        width: 190,
        fixed: 'right',
        render: (_unused, row) => (
          <Space size={4}>
            <Button size="small" onClick={() => void openDetail(row.id)}>
              详情
            </Button>
            <Button
              size="small"
              onClick={() => void handleQuickToggleImportant(row)}
            >
              {row.review.isImportant ? '取消重点' : '标记重点'}
            </Button>
            <Popconfirm
              title="确认归档这道题？"
              okText="归档"
              cancelText="取消"
              onConfirm={() => void handleArchive(row)}
            >
              <Button size="small">归档</Button>
            </Popconfirm>
          </Space>
        ),
      },
    ];
      return allColumns.filter((column) => visibleColumns.includes(column.columnKey));
    },
    [reviewSort, visibleColumns],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size={8}>
          <Input.Search
            allowClear
            placeholder="关键词搜索题干/题号/Domain"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={() => {
              setPage(1);
              void loadQuestions();
            }}
            style={{ width: 280 }}
          />
          <Select
            allowClear
            placeholder="状态"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={statusOptions}
            style={{ width: 140 }}
          />
          <Select
            allowClear
            placeholder="标签"
            value={tag}
            onChange={(value) => {
              setTag(value);
              setPage(1);
            }}
            options={availableTags.map((item) => ({ value: item, label: item }))}
            style={{ width: 180 }}
          />
          <Input
            allowClear
            placeholder="来源 source"
            value={source}
            onChange={(e) => {
              setSource(e.target.value || undefined);
              setPage(1);
            }}
            style={{ width: 140 }}
          />
          <Space>
            <Text>只看重点</Text>
            <Switch
              checked={important}
              onChange={(checked) => {
                setImportant(checked);
                setPage(1);
              }}
            />
          </Space>
          <Space>
            <Text>只看已复习</Text>
            <Switch
              checked={reviewedOnly}
              onChange={(checked) => {
                setReviewedOnly(checked);
                setPage(1);
                setReviewSort((prev) => (checked && prev === 'default' ? 'reviewCountDesc' : prev));
              }}
            />
          </Space>
          <Select
            value={reviewSort}
            onChange={(value) => {
              setReviewSort(value);
              setPage(1);
            }}
            options={reviewSortOptions}
            style={{ width: 180 }}
          />
          <Space direction="vertical" size={2}>
            <Text type="secondary">列显示</Text>
            <Checkbox.Group
              options={columnOptions}
              value={visibleColumns.filter((item) => item !== 'actions')}
              onChange={(values) => {
                setVisibleColumns(normalizeVisibleColumns(values));
              }}
            />
          </Space>
          <Button
            onClick={() => {
              void loadQuestions();
            }}
          >
            刷新
          </Button>
          <Button type="primary" onClick={() => setImportOpen(true)}>
            导入题目
          </Button>
        </Space>
        <Space wrap style={{ marginTop: 8 }}>
          {Object.entries(statusSummary).map(([key, value]) => (
            <Tag key={key}>{`${key}: ${value}`}</Tag>
          ))}
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        tableLayout="auto"
        scroll={{ x: 1280 }}
        onChange={(_pagination, _filters, sorter) => {
          if (Array.isArray(sorter)) return;
          const activeSortKey =
            sorter?.columnKey ??
            (typeof sorter?.field === 'string' ? sorter.field : undefined) ??
            (typeof sorter?.column?.key === 'string' ? sorter.column.key : undefined);
          if (activeSortKey !== 'reviewStats') return;
          const nextSort =
            sorter.order === 'descend'
              ? 'reviewCountDesc'
              : sorter.order === 'ascend'
                ? 'reviewCountAsc'
                : 'default';
          setReviewSort(nextSort);
          setPage(1);
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (value) => `总计 ${value} 题`,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />

      <Drawer
        title={detail ? `题目详情 #${detail.question.id}` : '题目详情'}
        extra={
          <Space>
            <Button
              disabled={!hasPreviousDetail || detailLoading || detailNavLoading}
              loading={detailNavLoading}
              onClick={() => void handleNavigateDetail('previous')}
            >
              上一题
            </Button>
            <Button
              disabled={!hasNextDetail || detailLoading || detailNavLoading}
              loading={detailNavLoading}
              onClick={() => void handleNavigateDetail('next')}
            >
              下一题
            </Button>
          </Space>
        }
        open={detailOpen}
        width={820}
        onClose={() => {
          setDetailOpen(false);
          setDetail(null);
          setSelectedId(null);
          setNoteComposerOpen(false);
          noteForm.resetFields();
        }}
        destroyOnClose
      >
        {detailLoading || !detail ? (
          <Text type="secondary">加载中...</Text>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" title="题干">
              <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {detail.question.stem}
              </Paragraph>
              <Space direction="vertical" style={{ marginTop: 12, width: '100%' }}>
                {detail.options.map((opt) => (
                  <Card key={opt.key} size="small">
                    <Text strong>{opt.key}. </Text>
                    <Text style={{ whiteSpace: 'pre-wrap' }}>{opt.text}</Text>
                  </Card>
                ))}
              </Space>
              <Space style={{ marginTop: 12 }}>
                <Button onClick={() => setShowAnswer((prev) => !prev)}>
                  {showAnswer ? '隐藏来源答案' : '显示来源答案'}
                </Button>
                {showAnswer ? (
                  <Tag color="magenta">{detail.question.sourceAnswer || '未提供答案'}</Tag>
                ) : null}
              </Space>
            </Card>

            <Card size="small" title="备注（支持 Markdown）">
              <Collapse
                ghost
                activeKey={noteComposerOpen ? ['noteComposer'] : []}
                onChange={(keys) => {
                  const activeKeys = Array.isArray(keys) ? keys : [keys];
                  setNoteComposerOpen(activeKeys.includes('noteComposer'));
                }}
                items={[
                  {
                    key: 'noteComposer',
                    label: detail.notes.length > 0 ? '添加新备注' : '添加备注',
                    children: (
                      <Form form={noteForm} layout="vertical" requiredMark={false}>
                        <Form.Item
                          label="类型"
                          name="noteType"
                          rules={[{ required: true, message: '请选择备注类型' }]}
                          initialValue={DEFAULT_NOTE_TYPE}
                        >
                          <Select options={noteTypeOptions} />
                        </Form.Item>
                        <Form.Item label="标题" name="title">
                          <Input placeholder="可选" />
                        </Form.Item>
                        <Form.Item
                          label="内容（Markdown）"
                          name="content"
                          rules={[{ required: true, message: '请输入备注内容' }]}
                        >
                          <TextArea rows={4} placeholder="支持 **加粗**、`代码`、- 列表、[链接](https://...)" />
                        </Form.Item>
                        <Form.Item label="链接" name="url">
                          <Input placeholder="https://docs.aws.amazon.com/..." />
                        </Form.Item>
                        <Button type="primary" loading={addingNote} onClick={() => void handleAddNote()}>
                          {addingNote ? '添加中...' : '添加备注'}
                        </Button>
                      </Form>
                    ),
                  },
                ]}
              />
              <Space direction="vertical" style={{ width: '100%', marginTop: detail.notes.length > 0 ? 16 : 0 }}>
                {detail.notes.map((note) => (
                  <Card
                    key={note.id}
                    size="small"
                    title={
                      <Space wrap>
                        <Tag>{note.note_type}</Tag>
                        {note.title ? <Text>{note.title}</Text> : null}
                        <Text type="secondary">{formatDateTime(note.updated_at)}</Text>
                      </Space>
                    }
                    extra={
                      <Space>
                        <Button size="small" onClick={() => handleOpenEditNote(note)}>
                          编辑
                        </Button>
                        <Popconfirm
                          title="确认删除该备注？"
                          okText="删除"
                          cancelText="取消"
                          onConfirm={() => void handleDeleteNote(note.id)}
                        >
                          <Button size="small" danger>
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    }
                  >
                    <div
                      style={{ lineHeight: 1.6 }}
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(note.content) }}
                    />
                    {note.url ? (
                      <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                        <a href={note.url} target="_blank" rel="noopener noreferrer">
                          {note.url}
                        </a>
                      </Paragraph>
                    ) : null}
                  </Card>
                ))}
              </Space>
            </Card>
            <Card size="small" title="复习状态">
              <Form form={reviewForm} layout="vertical" requiredMark={false}>
                <Space wrap style={{ width: '100%' }} align="start">
                  <Form.Item name="status" label="状态" style={{ minWidth: 140 }}>
                    <Select options={statusOptions} />
                  </Form.Item>
                  <Form.Item name="isImportant" label="重点" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="myFinalAnswer" label="我的最终答案" style={{ minWidth: 140 }}>
                    <Input placeholder="例如 A,C" />
                  </Form.Item>
                  <Form.Item name="confidence" label="把握度" style={{ minWidth: 140 }}>
                    <Select
                      allowClear
                      options={[
                        { value: 'low', label: 'low' },
                        { value: 'medium', label: 'medium' },
                        { value: 'high', label: 'high' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="lastResult" label="本次结果" style={{ minWidth: 140 }}>
                    <Select allowClear options={lastResultOptions} />
                  </Form.Item>
                  <Form.Item name="nextReviewAt" label="下次复习时间" style={{ minWidth: 220 }}>
                    <DatePicker showTime style={{ width: '100%' }} />
                  </Form.Item>
                </Space>
              </Form>
              <Space style={{ marginBottom: 8 }}>
                <Text type="secondary">
                  已复习 {detail.question.review.reviewCount} 次，错题 {detail.question.review.wrongCount} 次，连续答对{' '}
                  {detail.question.review.correctStreak} 次
                </Text>
              </Space>
              <Space>
                <Button type="primary" loading={savingReview} onClick={() => void handleSaveReview()}>
                  {savingReview ? '保存中...' : '保存状态'}
                </Button>
                <Text type="secondary">
                  上次复习：{formatDateTime(detail.question.review.lastReviewedAt)}
                </Text>
              </Space>
            </Card>

          </Space>
        )}
      </Drawer>

      <Modal
        title="导入 SAP-C02 题目"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={null}
        width={760}
        destroyOnClose
      >
        <Space style={{ marginBottom: 12 }}>
          <Button
            type={activeImportTab === 'manual' ? 'primary' : 'default'}
            onClick={() => setActiveImportTab('manual')}
          >
            手动录入
          </Button>
          <Button
            type={activeImportTab === 'json' ? 'primary' : 'default'}
            onClick={() => setActiveImportTab('json')}
          >
            JSON 导入
          </Button>
        </Space>

        {activeImportTab === 'manual' ? (
          <Form form={manualImportForm} layout="vertical" requiredMark={false}>
            <Form.Item name="source" label="来源" initialValue="manual">
              <Input placeholder="manual / examtopics / json" />
            </Form.Item>
            <Form.Item name="sourceQuestionNo" label="题号">
              <Input />
            </Form.Item>
            <Form.Item name="sourceTopic" label="主题">
              <Input />
            </Form.Item>
            <Form.Item name="domain" label="Domain">
              <Input />
            </Form.Item>
            <Form.Item name="sourceUrl" label="来源 URL">
              <Input />
            </Form.Item>
            <Form.Item
              name="stem"
              label="题干"
              rules={[{ required: true, message: '请输入题干' }]}
            >
              <TextArea rows={4} />
            </Form.Item>
            <Form.Item
              name="optionsText"
              label="选项（每行一项，格式如 A: xxx）"
              rules={[{ required: true, message: '请输入选项' }]}
            >
              <TextArea rows={5} placeholder={`A: Option A\nB: Option B\nC: Option C`} />
            </Form.Item>
            <Form.Item name="sourceAnswer" label="来源答案">
              <Input placeholder="例如 A 或 A,C" />
            </Form.Item>
            <Form.Item name="tags" label="标签（逗号分隔）">
              <Input placeholder="VPC, Route 53, DR" />
            </Form.Item>
            <Form.Item name="explanation" label="来源解析">
              <TextArea rows={3} />
            </Form.Item>
            <Button type="primary" loading={importing} onClick={() => void handleSubmitManualImport()}>
              提交导入
            </Button>
          </Form>
        ) : (
          <Form form={jsonImportForm} layout="vertical" requiredMark={false}>
            <Form.Item
              name="jsonText"
              label="JSON 内容"
              rules={[{ required: true, message: '请输入 JSON 内容' }]}
            >
              <TextArea
                rows={16}
                placeholder={`[\n  {\n    "examCode": "SAP-C02",\n    "source": "manual",\n    "stem": "Question text...",\n    "options": { "A": "Option A", "B": "Option B" }\n  }\n]`}
              />
            </Form.Item>
            <Button type="primary" loading={importing} onClick={() => void handleSubmitJsonImport()}>
              导入 JSON
            </Button>
          </Form>
        )}
      </Modal>

      <Modal
        title="编辑备注"
        open={editNoteOpen}
        onCancel={() => {
          setEditNoteOpen(false);
          setEditingNoteId(null);
          editNoteForm.resetFields();
        }}
        onOk={() => void handleSaveEditedNote()}
        okText="保存"
        confirmLoading={savingEditedNote}
        zIndex={1200}
      >
        <Form form={editNoteForm} layout="vertical" requiredMark={false}>
          <Form.Item
            label="类型"
            name="noteType"
            rules={[{ required: true, message: '请选择备注类型' }]}
          >
            <Select options={noteTypeOptions} />
          </Form.Item>
          <Form.Item label="标题" name="title">
            <Input />
          </Form.Item>
          <Form.Item
            label="内容（Markdown）"
            name="content"
            rules={[{ required: true, message: '请输入备注内容' }]}
          >
            <TextArea rows={5} />
          </Form.Item>
          <Form.Item label="链接" name="url">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

export default CertStudyPage;
