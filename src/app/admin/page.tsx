"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

interface SheetRecord {
  rowId: number;
  timestamp: string;
  name: string;
  finishtime: string;
  timeSeconds?: number;
}

export default function AdminPage() {
  const [records, setRecords] = useState<SheetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editTime, setEditTime] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // 새 기록 추가용 state
  const [newName, setNewName] = useState("");
  const [newTime, setNewTime] = useState("");

  const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL || "";

  // 1. READ (조회)
  const fetchRecords = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      const res = await fetch("/api/scores");
      const json = await res.json();
      
      // 직접 스크립트에서도 조회
      if (scriptUrl) {
        const directRes = await fetch(scriptUrl);
        const directJson = await directRes.json();
        if (directJson.status === "success" && Array.isArray(directJson.data)) {
          setRecords(directJson.data);
          setLoading(false);
          return;
        }
      }
      setRecords(json.scores || []);
    } catch (e: any) {
      setStatusMsg("조회 중 오류 발생: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  // 2. CREATE (추가)
  const handleCreate = async () => {
    if (!newName.trim() || !newTime.trim()) {
      alert("이름과 완료 시간을 모두 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "create",
          timestamp: now,
          name: newName.trim(),
          finishtime: newTime.trim(),
        }),
      });
      setNewName("");
      setNewTime("");
      setStatusMsg("✅ 성공적으로 추가되었습니다.");
      await fetchRecords();
    } catch (e: any) {
      setStatusMsg("❌ 추가 실패: " + e.message);
      setLoading(false);
    }
  };

  // 3. UPDATE (수정)
  const startEdit = (record: SheetRecord) => {
    setEditingRowId(record.rowId);
    setEditName(record.name);
    setEditTime(record.finishtime);
  };

  const handleUpdate = async (rowId: number) => {
    setLoading(true);
    try {
      await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "update",
          rowId: rowId,
          name: editName.trim(),
          finishtime: editTime.trim(),
        }),
      });
      setEditingRowId(null);
      setStatusMsg("✅ 성공적으로 수정되었습니다.");
      await fetchRecords();
    } catch (e: any) {
      setStatusMsg("❌ 수정 실패: " + e.message);
      setLoading(false);
    }
  };

  // 4. DELETE (삭제)
  const handleDelete = async (rowId: number) => {
    if (!confirm(`${rowId}번 행 데이터를 정말 삭제하시겠습니까?`)) return;
    setLoading(true);
    try {
      await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "delete",
          rowId: rowId,
        }),
      });
      setStatusMsg("✅ 성공적으로 삭제되었습니다.");
      await fetchRecords();
    } catch (e: any) {
      setStatusMsg("❌ 삭제 실패: " + e.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-6 flex flex-col items-center">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
          <div>
            <h1 className="text-2xl font-black text-sky-800">📊 구글 시트 CRUD 관리 패널</h1>
            <p className="text-xs text-slate-500 mt-1">
              구글 스프레드시트와 실시간 연동되어 데이터를 직접 추가/조회/수정/삭제합니다.
            </p>
          </div>
          <Link
            href="/"
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition"
          >
            🎮 게임으로 돌아가기
          </Link>
        </div>

        {statusMsg && (
          <div className="mb-4 p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-800 font-medium">
            {statusMsg}
          </div>
        )}

        {/* CREATE 섹션 */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
          <h2 className="text-sm font-bold text-slate-700 mb-2.5">➕ 새 기록 추가 (Create)</h2>
          <div className="flex flex-wrap gap-2.5">
            <input
              type="text"
              placeholder="이름 (예: 정채린)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 min-w-[140px] px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <input
              type="text"
              placeholder="완료 시간 (예: 0분 15초)"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="flex-1 min-w-[140px] px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              onClick={handleCreate}
              disabled={loading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50"
            >
              추가하기
            </button>
          </div>
        </div>

        {/* READ & UPDATE & DELETE 테이블 */}
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-bold text-slate-700">📋 스프레드시트 데이터 목록 (Read / Update / Delete)</h2>
          <button
            onClick={fetchRecords}
            disabled={loading}
            className="text-xs text-sky-600 hover:text-sky-700 font-semibold flex items-center gap-1"
          >
            🔄 새로고침
          </button>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-3 w-16 text-center">행(Row)</th>
                <th className="p-3">타임스탬프 (timestamp)</th>
                <th className="p-3">플레이어 이름 (name)</th>
                <th className="p-3">완료 시간 (finishtime)</th>
                <th className="p-3 text-center w-32">관리 (Action)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    구글 시트에서 데이터를 불러오는 중입니다...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    스프레드시트에 등록된 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.rowId} className="hover:bg-slate-50/80 transition">
                    <td className="p-3 text-center font-mono text-slate-400">{r.rowId}</td>
                    <td className="p-3 text-slate-500">{r.timestamp}</td>
                    <td className="p-3 font-semibold text-slate-800">
                      {editingRowId === r.rowId ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="px-2 py-1 text-xs border border-sky-400 rounded bg-white w-full"
                        />
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="p-3 font-mono text-sky-700 font-bold">
                      {editingRowId === r.rowId ? (
                        <input
                          type="text"
                          value={editTime}
                          onChange={(e) => setEditTime(e.target.value)}
                          className="px-2 py-1 text-xs border border-sky-400 rounded bg-white w-full"
                        />
                      ) : (
                        r.finishtime
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {editingRowId === r.rowId ? (
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => handleUpdate(r.rowId)}
                            className="px-2.5 py-1 bg-sky-600 text-white rounded text-[11px] font-bold"
                          >
                            저장
                          </button>
                          <button
                            onClick={() => setEditingRowId(null)}
                            className="px-2 py-1 bg-slate-200 text-slate-600 rounded text-[11px]"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => startEdit(r)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold border border-slate-200"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDelete(r.rowId)}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded text-[11px] font-semibold border border-rose-200"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
