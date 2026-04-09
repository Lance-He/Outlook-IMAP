import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Mail,
  Settings,
  Plus,
  RefreshCw,
  ChevronRight,
  Inbox,
  AlertCircle,
  CheckCircle2,
  Clock,
  LayoutDashboard,
  Search,
  Edit2,
  StickyNote,
  Tag,
  Save,
  X,
  Trash2,
  RadioTower
} from "lucide-react";
import { api } from "./api";
import type { Account, AccountTag, AppEvent, MessageDetail, MessageSummary, Settings as AppSettings } from "./types";

const intervalOptions = [5, 10, 30, 60];

const tagPalette: Array<{
  color: AccountTag["color"];
  label: string;
  pillClass: string;
  swatchClass: string;
}> = [
  {
    color: "blue",
    label: "蓝色",
    pillClass: "border-blue-200 bg-blue-50 text-blue-700",
    swatchClass: "bg-blue-500"
  },
  {
    color: "emerald",
    label: "绿色",
    pillClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    swatchClass: "bg-emerald-500"
  },
  {
    color: "amber",
    label: "黄色",
    pillClass: "border-amber-200 bg-amber-50 text-amber-700",
    swatchClass: "bg-amber-500"
  },
  {
    color: "rose",
    label: "红色",
    pillClass: "border-rose-200 bg-rose-50 text-rose-700",
    swatchClass: "bg-rose-500"
  },
  {
    color: "cyan",
    label: "青色",
    pillClass: "border-cyan-200 bg-cyan-50 text-cyan-700",
    swatchClass: "bg-cyan-500"
  },
  {
    color: "slate",
    label: "灰色",
    pillClass: "border-slate-200 bg-slate-100 text-slate-600",
    swatchClass: "bg-slate-500"
  }
];

type ToastTone = "error" | "success" | "info";

type ToastState = {
  message: string;
  tone: ToastTone;
};

function createTagId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getTagTheme(color: AccountTag["color"]) {
  return tagPalette.find((item) => item.color === color) ?? tagPalette[0];
}

function getPreviewTags(tags: AccountTag[]) {
  return {
    visible: tags.slice(0, 2),
    hiddenCount: Math.max(tags.length - 2, 0)
  };
}

function isImportingAccount(account: Account) {
  return account.runtimeStatus === "导入中";
}

function isImportFailedAccount(account: Account) {
  return account.runtimeStatus === "导入失败" || account.verifyStatus === "导入失败";
}

function statusDotClass(account: Account) {
  if (isImportingAccount(account)) {
    return "animate-pulse bg-amber-400";
  }

  if (isImportFailedAccount(account)) {
    return "bg-red-500";
  }

  if (account.runtimeStatus === "异常" || account.lastError) {
    return "bg-red-500";
  }

  if (account.runtimeStatus === "正常" || account.runtimeStatus === "同步中" || account.enabled) {
    return "animate-pulse bg-green-500";
  }

  return "bg-slate-300";
}

function statusTextClass(account: Account) {
  if (isImportingAccount(account)) {
    return "font-medium text-amber-500";
  }

  if (isImportFailedAccount(account) || account.runtimeStatus === "异常") {
    return "font-medium text-red-500";
  }

  if (account.enabled || account.runtimeStatus === "正常" || account.runtimeStatus === "同步中") {
    return "font-medium text-green-600";
  }

  return "";
}

const App = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [selectedMail, setSelectedMail] = useState<MessageSummary | null>(null);
  const [selectedMailDetail, setSelectedMailDetail] = useState<MessageDetail | null>(null);
  const [selectedRawMail, setSelectedRawMail] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [noteModalAccount, setNoteModalAccount] = useState<Account | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [tagModalAccount, setTagModalAccount] = useState<Account | null>(null);
  const [tagDrafts, setTagDrafts] = useState<AccountTag[]>([]);
  const [tagNameDraft, setTagNameDraft] = useState("");
  const [tagColorDraft, setTagColorDraft] = useState<AccountTag["color"]>("blue");
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState("");
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [detailMode, setDetailMode] = useState<"preview" | "raw">("preview");
  const [importing, setImporting] = useState(false);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({
    pullIntervalSec: 60,
    maxConcurrency: 3,
    retryBackoffSec: 30
  });
  const activeAccountIdRef = useRef<string | null>(null);
  const selectedMailIdRef = useRef<string | null>(null);

  const activeAccount = accounts.find((account) => account.id === activeAccountId) || null;

  useEffect(() => {
    activeAccountIdRef.current = activeAccountId;
  }, [activeAccountId]);

  useEffect(() => {
    selectedMailIdRef.current = selectedMail?.id || null;
  }, [selectedMail?.id]);

  const filteredMails =
    messages.filter((mail) => {
      const keyword = searchQuery.trim().toLowerCase();
      if (!keyword) {
        return true;
      }

      return [mail.subject, mail.fromName, mail.fromAddress, mail.textPreview]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    }) || [];

  const importSummary = useMemo(() => {
    return {
      success: 0,
      error: 0
    };
  }, []);

  function showToast(message: string, tone: ToastTone = "error") {
    setToast({ message, tone });
    window.setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 4000);
  }

  function openSettingsModal() {
    if (settings) {
      setSettingsDraft({
        pullIntervalSec: settings.pullIntervalSec,
        maxConcurrency: settings.maxConcurrency,
        retryBackoffSec: settings.retryBackoffSec
      });
    }

    setShowSettingsModal(true);
  }

  async function loadSettings() {
    const nextSettings = await api.getSettings();
    setSettings(nextSettings);
  }

  async function loadAccounts(preferredAccountId?: string | null) {
    const nextAccounts = await api.getAccounts();
    setAccounts(nextAccounts);

    const nextId =
      preferredAccountId && nextAccounts.some((account) => account.id === preferredAccountId)
        ? preferredAccountId
        : nextAccounts[0]?.id || null;

    setActiveAccountId(nextId);
    return nextAccounts;
  }

  async function loadMessages(accountId: string, preferredMailId?: string | null) {
    const nextMessages = await api.getMessages(accountId);
    setMessages(nextMessages);

    const nextMail =
      (preferredMailId && nextMessages.find((mail) => mail.id === preferredMailId)) ||
      nextMessages[0] ||
      null;

    setSelectedMail(nextMail);
    return nextMessages;
  }

  async function loadMailDetail(mailId: string) {
    const detail = await api.getMessage(mailId);
    setSelectedMailDetail(detail);
  }

  useEffect(() => {
    void Promise.all([loadSettings(), loadAccounts(null)]).catch((error) => {
      showToast(error instanceof Error ? error.message : "初始化失败");
    });
  }, []);

  useEffect(() => {
    if (!activeAccountId) {
      setMessages([]);
      setSelectedMail(null);
      setSelectedMailDetail(null);
      setSelectedRawMail("");
      return;
    }

    void loadMessages(activeAccountId, selectedMail?.id).catch((error) => {
      showToast(error instanceof Error ? error.message : "邮件列表加载失败");
    });
  }, [activeAccountId]);

  useEffect(() => {
    if (!selectedMail?.id) {
      setSelectedMailDetail(null);
      setSelectedRawMail("");
      return;
    }

    setDetailMode("preview");
    setSelectedRawMail("");
    void loadMailDetail(selectedMail.id).catch((error) => {
      showToast(error instanceof Error ? error.message : "邮件详情加载失败");
    });
  }, [selectedMail?.id]);

  useEffect(() => {
    const eventSource = new EventSource("/api/events/stream");

    eventSource.onmessage = (event) => {
      if (!event.data) {
        return;
      }

      let payload: AppEvent;

      try {
        payload = JSON.parse(event.data) as AppEvent;
      } catch {
        return;
      }

      if (payload.type === "settings_updated") {
        void loadSettings().catch(() => undefined);
      }

      void loadAccounts(activeAccountIdRef.current).catch(() => undefined);

      if (payload.accountId && payload.accountId === activeAccountIdRef.current) {
        void loadMessages(payload.accountId, selectedMailIdRef.current).catch(() => undefined);
      }
    };

    eventSource.onerror = () => {
      showToast("实时推送连接已断开，浏览器会自动重连。");
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (detailMode !== "raw" || !selectedMail?.id || selectedRawMail) {
      return;
    }

    setLoadingRaw(true);
    void api
      .getRawMessage(selectedMail.id)
      .then((raw) => {
        setSelectedRawMail(raw);
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : "原始邮件读取失败");
      })
      .finally(() => {
        setLoadingRaw(false);
      });
  }, [detailMode, selectedMail, selectedRawMail]);

  const handleAddAccounts = async () => {
    if (!bulkInput.trim()) {
      return;
    }

    setImporting(true);

    try {
      const result = await api.importAccounts(bulkInput);
      const summary = result.results.reduce(
        (accumulator, item) => {
          if (item.status === "success") {
            accumulator.success += 1;
          } else {
            accumulator.error += 1;
          }
          return accumulator;
        },
        { ...importSummary }
      );

      await loadAccounts(activeAccountId);

      if (summary.success > 0) {
        setBulkInput("");
        setShowAddModal(false);
      }

      if (summary.success > 0) {
        showToast(
          summary.error > 0
            ? `已加入导入队列 ${summary.success} 条，另外有 ${summary.error} 条未通过格式或重复检查`
            : `已加入导入队列 ${summary.success} 条，账户会继续在列表中后台验证`,
          "success"
        );
      } else {
        showToast(`没有可导入的账号，失败 ${summary.error} 条`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const deleteAccount = async (accountId: string) => {
    const target = accounts.find((account) => account.id === accountId);
    const allow = window.confirm(`确认删除邮箱 ${target?.email || accountId} 吗？`);

    if (!allow) {
      return;
    }

    try {
      await api.deleteAccount(accountId);

      if (activeAccountId === accountId) {
        setSelectedMail(null);
        setSelectedMailDetail(null);
        setSelectedRawMail("");
      }

      await loadAccounts(activeAccountId === accountId ? null : activeAccountId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除账户失败");
    }
  };

  const toggleAutoRefresh = async (account: Account) => {
    try {
      if (account.enabled) {
        await api.stopAccount(account.id);
      } else {
        await api.startAccount(account.id);
      }

      await loadAccounts(account.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "切换账户状态失败");
    }
  };

  const startEditingName = (account: Account) => {
    setEditingNameId(account.id);
    setTempName(account.displayName);
  };

  const openTagModal = (account: Account) => {
    setTagModalAccount(account);
    setTagDrafts(account.tags || []);
    setTagNameDraft("");
    setTagColorDraft("blue");
  };

  const saveName = async (accountId: string) => {
    const currentAccount = accounts.find((account) => account.id === accountId);

    if (!currentAccount) {
      setEditingNameId(null);
      return;
    }

    try {
      await api.updateAccount(accountId, {
        displayName: tempName.trim() || currentAccount.email
      });
      await loadAccounts(accountId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "修改名称失败");
    } finally {
      setEditingNameId(null);
    }
  };

  const updateNote = async (accountId: string, newNote: string) => {
    try {
      await api.updateAccount(accountId, {
        note: newNote
      });
      await loadAccounts(accountId);
      setNoteModalAccount(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存备注失败");
    }
  };

  const addTagDraft = () => {
    const nextName = tagNameDraft.trim();
    if (!nextName) {
      showToast("请输入标签名称");
      return;
    }

    const duplicated = tagDrafts.some((tag) => tag.name.toLowerCase() === nextName.toLowerCase());
    if (duplicated) {
      showToast("该标签已存在");
      return;
    }

    setTagDrafts((current) => [
      ...current,
      {
        id: createTagId(),
        name: nextName,
        color: tagColorDraft
      }
    ]);
    setTagNameDraft("");
  };

  const removeTagDraft = (tagId: string) => {
    setTagDrafts((current) => current.filter((tag) => tag.id !== tagId));
  };

  const saveTags = async (accountId: string) => {
    try {
      await api.updateAccount(accountId, {
        tags: tagDrafts
      });
      await loadAccounts(accountId);
      setTagModalAccount(null);
      showToast("标签已保存", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存标签失败");
    }
  };

  const fetchMails = async (accountId: string) => {
    try {
      await api.syncAccount(accountId);
      showToast("已触发同步，等待后端推送结果...", "info");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "触发同步失败");
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);

    try {
      const nextSettings = await api.updateSettings({
        pullIntervalSec: normalizeNumber(settingsDraft.pullIntervalSec, 60, 5),
        maxConcurrency: normalizeNumber(settingsDraft.maxConcurrency, 3, 1, 10),
        retryBackoffSec: normalizeNumber(settingsDraft.retryBackoffSec, 30, 15)
      });
      setSettings(nextSettings);

      await loadAccounts(activeAccountIdRef.current);

      setShowSettingsModal(false);
      showToast("系统配置已保存", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "系统配置保存失败");
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 font-sans text-slate-900">
      <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between p-6">
          <h1 className="flex items-center gap-2 text-xl font-bold text-blue-600">
            <Mail size={24} /> Outlook IMAP
          </h1>
        </div>

        <div className="mb-4 px-4">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-blue-700"
          >
            <Plus size={18} /> 添加邮箱
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
          {accounts.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">
                <Mail className="text-slate-300" size={24} />
              </div>
              <p className="text-sm text-slate-400">暂无邮箱，请先添加</p>
            </div>
          ) : (
            accounts.map((acc) => (
              <div
                key={acc.id}
                onClick={() => setActiveAccountId(acc.id)}
                className={`group flex flex-col rounded-xl border p-3.5 transition-all ${
                  activeAccountId === acc.id
                    ? "border-blue-200 bg-blue-50 shadow-sm"
                    : "cursor-pointer border-transparent bg-transparent hover:border-slate-100 hover:bg-slate-50"
                }`}
              >
                <div className="mb-1.5 flex items-start justify-between">
                  <div className="min-w-0 flex-1 pr-2">
                    {editingNameId === acc.id ? (
                      <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        <input
                          autoFocus
                          className="w-full border-b border-blue-400 bg-transparent py-0.5 text-sm font-bold outline-none"
                          value={tempName}
                          onChange={(event) => setTempName(event.target.value)}
                          onBlur={() => void saveName(acc.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              void saveName(acc.id);
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`truncate text-sm font-bold ${
                            activeAccountId === acc.id ? "text-blue-700" : "text-slate-700"
                          }`}
                        >
                          {acc.displayName || acc.email}
                        </span>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            startEditingName(acc);
                          }}
                          className="p-1 text-slate-400 opacity-0 transition-all hover:text-blue-500 group-hover:opacity-100"
                        >
                          <Edit2 size={12} />
                        </button>
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-[10px] text-slate-400">{acc.email}</div>
                    <div
                      className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5"
                      onClick={(event) => {
                        event.stopPropagation();
                        openTagModal(acc);
                      }}
                    >
                      {(() => {
                        const { visible, hiddenCount } = getPreviewTags(acc.tags || []);

                        if (visible.length === 0) {
                          return (
                            <button
                              className="rounded-full border border-dashed border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-400 transition-all hover:border-blue-200 hover:text-blue-600"
                            >
                              + 添加标签
                            </button>
                          );
                        }

                        return (
                          <>
                            {visible.map((tag) => (
                              <span
                                key={tag.id}
                                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${getTagTheme(tag.color).pillClass}`}
                              >
                                {tag.name}
                              </span>
                            ))}
                            {hiddenCount > 0 ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                                +{hiddenCount}
                              </span>
                            ) : null}
                            <button
                              className="rounded-full border border-dashed border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-400 transition-all hover:border-blue-200 hover:text-blue-600"
                            >
                              + 标签
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setNoteModalAccount(acc);
                        setNoteDraft(acc.note || "");
                      }}
                      className={`rounded-lg p-1.5 transition-colors ${
                        acc.note ? "text-amber-500" : "text-slate-300 hover:text-amber-500"
                      }`}
                      title="备注"
                    >
                      <StickyNote size={15} fill={acc.note ? "currentColor" : "none"} fillOpacity={0.1} />
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteAccount(acc.id);
                      }}
                      className="rounded-lg p-1.5 text-slate-300 transition-all hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="mt-1 flex items-center justify-between border-t border-slate-100/50 pt-1 text-[11px]">
                  <div className="flex items-center gap-1 text-slate-500">
                    <div className={`h-1.5 w-1.5 rounded-full ${statusDotClass(acc)}`} />
                    <span className={statusTextClass(acc)}>
                      {acc.runtimeStatus || (acc.enabled ? "正在刷新" : "等待中")}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 text-slate-400">
                    <Clock size={10} /> {formatShortTime(acc.lastSyncAt)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-slate-100 bg-slate-50/50 p-4">
          <div
            onClick={openSettingsModal}
            className="cursor-pointer px-2 py-2 text-slate-500 transition-colors hover:text-slate-800"
          >
            <div className="flex items-center gap-3">
              <Settings size={18} />
              <span className="text-sm font-medium">系统配置</span>
            </div>
            <div className="mt-2 flex items-center gap-2 pl-8 text-[11px] text-slate-400">
              <RadioTower size={12} />
              <span>
                抓取间隔 {settings?.pullIntervalSec ?? 60}s · 并发 {settings?.maxConcurrency ?? 3}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {!activeAccount ? (
          <div className="flex flex-1 flex-col items-center justify-center bg-white text-slate-400">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-slate-50">
              <LayoutDashboard size={40} strokeWidth={1} className="text-slate-200" />
            </div>
            <h3 className="text-lg font-medium text-slate-600">欢迎使用邮件管理系统</h3>
            <p className="text-sm">请在左侧选择一个邮箱账户查看详情</p>
          </div>
        ) : (
          <>
            <header className="z-10 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex flex-col">
                  <h2 className="max-w-[200px] truncate font-bold text-slate-800">{activeAccount.displayName}</h2>
                  <span className="text-[10px] text-slate-400">{activeAccount.email}</span>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div className="flex items-center gap-3 rounded-full border border-slate-100 bg-slate-50 px-3 py-1.5">
                  <span className="text-xs font-medium text-slate-600">自动抓取</span>
                  <button
                    onClick={() => void toggleAutoRefresh(activeAccount)}
                    className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                      activeAccount.enabled ? "bg-green-500 shadow-inner" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                        activeAccount.enabled ? "translate-x-[22px]" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="搜索标题或发件人..."
                    className="w-72 rounded-xl border-none bg-slate-100 py-2 pl-9 pr-4 text-sm shadow-inner transition-all focus:ring-2 focus:ring-blue-500"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
                <button
                  onClick={() => void fetchMails(activeAccount.id)}
                  className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm transition-all hover:bg-slate-50 hover:text-blue-600 active:scale-95"
                  title="手动刷新邮件库"
                >
                  <RefreshCw size={18} className={activeAccount.enabled ? "animate-spin-slow" : ""} />
                </button>
              </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
              <div className="w-[380px] overflow-y-auto border-r border-slate-200 bg-white">
                {filteredMails.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50">
                      <Inbox className="text-slate-200" size={32} />
                    </div>
                    <p className="text-sm font-medium italic text-slate-400">收件箱空空如也</p>
                  </div>
                ) : (
                  filteredMails.map((mail) => (
                    <div
                      key={mail.id}
                      onClick={() => setSelectedMail(mail)}
                      className={`relative cursor-pointer border-b border-slate-50 p-5 transition-all ${
                        selectedMail?.id === mail.id ? "bg-blue-50/70" : "hover:bg-slate-50"
                      }`}
                    >
                      {selectedMail?.id === mail.id ? (
                        <div className="absolute bottom-0 left-0 top-0 w-1.5 bg-blue-600" />
                      ) : null}
                      <div className="mb-1.5 flex items-start justify-between">
                        <span
                          className={`truncate pr-2 text-sm font-bold ${
                            selectedMail?.id === mail.id ? "text-blue-800" : "text-slate-800"
                          }`}
                        >
                          {mail.fromName || mail.fromAddress || "未知发件人"}
                        </span>
                        <span className="shrink-0 rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                          {formatShortTime(mail.receivedAt)}
                        </span>
                      </div>
                      <h4
                        className={`mb-2 truncate text-sm font-semibold ${
                          selectedMail?.id === mail.id ? "text-blue-900" : "text-slate-700"
                        }`}
                      >
                        {mail.subject || "(无主题)"}
                      </h4>
                      <p className="line-clamp-2 text-xs leading-relaxed text-slate-500 opacity-80">
                        {mail.textPreview || "暂无正文预览"}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="flex-1 overflow-y-auto bg-white">
                {!selectedMail || !selectedMailDetail ? (
                  <div className="flex h-full flex-col items-center justify-center text-slate-300">
                    <div className="relative">
                      <Inbox size={64} strokeWidth={1} />
                      <div className="absolute -right-1 -top-1 h-4 w-4 animate-ping rounded-full bg-blue-500" />
                    </div>
                    <p className="mt-4 font-medium text-slate-400">请选择左侧邮件进行阅读</p>
                  </div>
                ) : (
                  <div className="mx-auto max-w-5xl p-10">
                    <div className="mb-8 flex items-start justify-between">
                      <div className="flex-1">
                        <h2 className="mb-6 text-3xl font-extrabold leading-tight text-slate-800">
                          {selectedMailDetail.subject || "(无主题)"}
                        </h2>
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-xl font-bold text-white shadow-lg">
                            {(selectedMailDetail.fromName || selectedMailDetail.fromAddress || "U")[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div className="text-base font-bold text-slate-800">
                              {selectedMailDetail.fromName || selectedMailDetail.fromAddress || "未知发件人"}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-slate-500">
                              发给: <span className="font-mono">{activeAccount.email}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="mb-4 rounded-full border border-slate-100 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-400">
                          {formatLongTime(selectedMailDetail.receivedAt)}
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setDetailMode("preview")}
                            className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold shadow-sm transition-all hover:bg-slate-50"
                          >
                            预览
                          </button>
                          <button
                            onClick={() => setDetailMode("raw")}
                            className="rounded-xl border border-red-100 bg-red-50/50 px-5 py-2 text-sm font-semibold text-red-500 shadow-sm transition-all hover:bg-red-50"
                          >
                            原始 MIME
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mb-10 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

                    {detailMode === "preview" ? (
                      selectedMailDetail.htmlContent ? (
                        <iframe
                          className="min-h-[720px] w-full rounded-2xl border border-slate-100 bg-white shadow-sm"
                          sandbox=""
                          srcDoc={buildPreviewDocument(selectedMailDetail.htmlContent)}
                          title="邮件真实渲染预览"
                        />
                      ) : (
                        <div className="prose prose-slate max-w-none text-lg leading-relaxed text-slate-700">
                          {(selectedMailDetail.textContent || "暂无正文内容").split("\n").map((paragraph, index) => (
                            <p key={index} className="mb-5">
                              {paragraph}
                            </p>
                          ))}
                        </div>
                      )
                    ) : (
                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6">
                        {loadingRaw ? (
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <RefreshCw size={16} className="animate-spin" />
                            正在读取原始 MIME...
                          </div>
                        ) : (
                          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-700">
                            {selectedRawMail || "暂无原始 MIME 内容"}
                          </pre>
                        )}
                      </div>
                    )}

                    <div className="mt-16 rounded-2xl border border-slate-100 bg-slate-50 p-6">
                      <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        <AlertCircle size={14} />
                        账户元数据 (调试)
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                          <p className="mb-1 text-[10px] text-slate-400">验证状态</p>
                          <p className="truncate text-xs font-bold text-slate-600">{activeAccount.verifyStatus}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                          <p className="mb-1 text-[10px] text-slate-400">全局抓取间隔</p>
                          <p className="truncate text-xs font-bold text-slate-600">
                            {settings?.pullIntervalSec ?? 60}s
                          </p>
                        </div>
                      </div>
                      {activeAccount.note ? (
                        <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 p-4 shadow-sm">
                          <p className="mb-1 flex items-center gap-1 text-[10px] font-bold text-amber-600">
                            <StickyNote size={12} /> 账户备注
                          </p>
                          <p className="text-sm text-amber-800">{activeAccount.note}</p>
                        </div>
                      ) : null}
                      {activeAccount.tags.length > 0 ? (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                          <p className="mb-2 flex items-center gap-1 text-[10px] font-bold text-slate-500">
                            <Tag size={12} /> 账户标签
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {activeAccount.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold ${getTagTheme(tag.color).pillClass}`}
                              >
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {showAddModal ? (
        <div className="fixed inset-0 z-50 flex animate-in fade-in items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md duration-300">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-8 py-6">
              <div>
                <h3 className="flex items-center gap-2 text-xl font-bold text-slate-800">
                  <Plus size={24} className="text-blue-600" /> 批量导入账号
                </h3>
                <p className="mt-1 text-xs text-slate-400">支持大规模 IMAP 账号快速上架</p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-full p-2 text-slate-400 shadow-sm transition-all hover:bg-white hover:text-slate-600"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-8">
              <div className="mb-6 flex items-start gap-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <div className="rounded-xl bg-blue-100 p-2 text-blue-600">
                  <CheckCircle2 size={20} />
                </div>
                <div className="text-xs leading-relaxed text-blue-800">
                  <strong>导入格式指南：</strong>
                  <br />
                  每行一个账号，严格遵循：
                  <code className="rounded bg-blue-100/50 px-1 font-bold">邮箱----密码----client_id----refresh_token</code>
                  <br />
                  导入后名称默认为邮箱，您可以后续进行二次编辑。
                </div>
              </div>
              <textarea
                className="h-72 w-full resize-none rounded-2xl border border-slate-200 p-5 font-mono text-sm shadow-inner outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                placeholder="example@outlook.com----password123----id_xxxx----token_yyyy"
                value={bulkInput}
                onChange={(event) => setBulkInput(event.target.value)}
              />
              <div className="mt-8 flex justify-end gap-3">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl px-8 py-3 font-bold text-slate-600 transition-all hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  onClick={() => void handleAddAccounts()}
                  disabled={!bulkInput.trim() || importing}
                  className="rounded-xl bg-blue-600 px-10 py-3 font-bold text-white shadow-lg shadow-blue-500/30 transition-all active:scale-95 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  确认导入 {bulkInput.split("\n").filter((line) => line.trim()).length} 个账号
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {noteModalAccount ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md">
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-6 py-4">
              <h3 className="flex items-center gap-2 font-bold text-amber-800">
                <StickyNote size={18} /> 账户备注: {noteModalAccount.displayName}
              </h3>
            </div>
            <div className="p-6">
              <textarea
                autoFocus
                className="h-40 w-full resize-none rounded-2xl border border-slate-200 p-4 text-sm outline-none transition-all focus:border-amber-400 focus:ring-4 focus:ring-amber-500/10"
                placeholder="在此输入您的备注内容..."
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
              />
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setNoteModalAccount(null)}
                  className="rounded-xl px-6 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={() => void updateNote(noteModalAccount.id, noteDraft)}
                  className="flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-2 text-sm font-bold text-white shadow-md shadow-amber-500/20 transition-all active:scale-95 hover:bg-amber-600"
                >
                  <Save size={16} /> 保存备注
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tagModalAccount ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-6 py-4">
              <h3 className="flex items-center gap-2 font-bold text-blue-800">
                <Tag size={18} /> 标签管理: {tagModalAccount.displayName}
              </h3>
              <button
                onClick={() => setTagModalAccount(null)}
                className="rounded-full p-2 text-blue-300 transition-all hover:bg-white hover:text-blue-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div>
                <label className="block text-xs font-semibold text-slate-500">新增标签</label>
                <div className="mt-2 flex gap-3">
                  <input
                    value={tagNameDraft}
                    onChange={(event) => setTagNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addTagDraft();
                      }
                    }}
                    className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    placeholder="例如：重点账号 / 客户 / 测试"
                  />
                  <button
                    onClick={addTagDraft}
                    className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-blue-500/20 transition-all active:scale-95 hover:bg-blue-700"
                  >
                    添加
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500">标签颜色</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tagPalette.map((item) => {
                    const selected = item.color === tagColorDraft;
                    return (
                      <button
                        key={item.color}
                        onClick={() => setTagColorDraft(item.color)}
                        className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-all ${
                          selected
                            ? `${item.pillClass} ring-2 ring-blue-200`
                            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                        }`}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${item.swatchClass}`} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold text-slate-500">当前标签</div>
                {tagDrafts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-400">
                    还没有标签，先添加一个吧
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tagDrafts.map((tag) => (
                      <span
                        key={tag.id}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${getTagTheme(tag.color).pillClass}`}
                      >
                        <span>{tag.name}</span>
                        <button
                          onClick={() => removeTagDraft(tag.id)}
                          className="rounded-full p-0.5 text-current/70 transition-all hover:bg-white/70 hover:text-current"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setTagModalAccount(null)}
                  className="rounded-xl px-6 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={() => void saveTags(tagModalAccount.id)}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2 text-sm font-bold text-white shadow-md shadow-blue-500/20 transition-all active:scale-95 hover:bg-blue-700"
                >
                  <Save size={16} /> 保存标签
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showSettingsModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-8 py-6">
              <div>
                <h3 className="flex items-center gap-2 text-xl font-bold text-slate-800">
                  <Settings size={24} className="text-blue-600" /> 系统配置
                </h3>
                <p className="mt-1 text-xs text-slate-400">集中管理当前项目里适合开放的配置项</p>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="rounded-full p-2 text-slate-400 shadow-sm transition-all hover:bg-white hover:text-slate-600"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-6 p-8">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                <label className="block text-xs font-semibold text-slate-500">自动抓取间隔（全局）</label>
                <select
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  value={settingsDraft.pullIntervalSec}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      pullIntervalSec: Number(event.target.value)
                    }))
                  }
                >
                  {intervalOptions.map((value) => (
                    <option key={value} value={value}>
                      {value} 秒
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-[10px] text-slate-400">
                  修改后将立即刷新所有自动抓取账号的下次拉取时间。
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2 rounded-2xl border border-slate-100 bg-slate-50 p-5">
                  <label className="block text-xs font-semibold text-slate-500">并发同步上限</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    value={settingsDraft.maxConcurrency}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        maxConcurrency: Number(event.target.value)
                      }))
                    }
                  />
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                  <label className="block text-xs font-semibold text-slate-500">失败重试等待时间</label>
                  <input
                    type="number"
                    min={15}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    value={settingsDraft.retryBackoffSec}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        retryBackoffSec: Number(event.target.value)
                      }))
                    }
                  />
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                  <div className="text-xs font-semibold text-slate-500">只读信息</div>
                  <div className="mt-2 space-y-2 break-all text-sm text-slate-600">
                    <div>实时推送模式：{settings?.pushMode ?? "SSE"}</div>
                    <div>调度扫描周期：{settings?.schedulerTickMs ?? 5000} ms</div>
                    <div>数据目录：{settings?.dataRoot ?? "-"}</div>
                    <div>邮件目录：{settings?.messagesRoot ?? "-"}</div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="rounded-xl px-8 py-3 font-bold text-slate-600 transition-all hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  onClick={() => void saveSettings()}
                  disabled={savingSettings}
                  className="rounded-xl bg-blue-600 px-10 py-3 font-bold text-white shadow-lg shadow-blue-500/30 transition-all active:scale-95 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSettings ? "保存中..." : "保存配置"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-2 rounded-xl border bg-white px-4 py-3 text-sm shadow-lg ${
            toast.tone === "success"
              ? "border-green-100 text-green-600"
              : toast.tone === "info"
                ? "border-blue-100 text-blue-600"
                : "border-red-100 text-red-600"
          }`}
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{toast.message}</span>
        </div>
      ) : null}
    </div>
  );
};

function formatShortTime(value: string | null) {
  if (!value) {
    return "尚未同步";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatLongTime(value: string | null) {
  if (!value) {
    return "暂无时间";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function normalizeNumber(value: number, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(value), min), max);
}

function buildPreviewDocument(htmlContent: string) {
  if (/<html[\s>]/i.test(htmlContent)) {
    if (/<head[\s>]/i.test(htmlContent)) {
      return htmlContent.replace(/<head([^>]*)>/i, '<head$1><base target="_blank" />');
    }

    return htmlContent.replace(
      /<html([^>]*)>/i,
      '<html$1><head><meta charset="utf-8" /><base target="_blank" /></head>'
    );
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <base target="_blank" />
  </head>
  <body>${htmlContent}</body>
</html>`;
}

export default App;
