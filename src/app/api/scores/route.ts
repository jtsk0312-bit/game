import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Next.js API 라우트
const DATA_FILE = path.join(process.cwd(), "leaderboard.json");

// 하드코딩 기본 URL (Vercel 환경 변수가 등록되지 않아도 바로 작동하도록 기본값 제공)
const DEFAULT_GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxYvQZiKGNf5_qHKXAq8w_wf4W-ALFsWe0WfyJSc9lyWKYYrB4hlW6GBVOv3u4pj1Kf/exec";

interface ScoreRecord {
  name: string;
  timeSeconds: number;
  timeFormatted: string;
  createdAt: string;
}

function getLocalScores(): ScoreRecord[] {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    // Vercel Serverless 환경에서는 읽기 전용 파일시스템일 수 있으므로 예외 무시
  }
  return [];
}

function saveLocalScore(record: ScoreRecord): ScoreRecord[] {
  try {
    const scores = getLocalScores();
    scores.push(record);
    scores.sort((a, b) => a.timeSeconds - b.timeSeconds);
    if (fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(scores, null, 2), "utf-8");
    }
    return scores;
  } catch (e) {
    return [record];
  }
}

function getGoogleScriptUrl() {
  return (
    process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL ||
    process.env.GOOGLE_SHEET_MACRO_URL ||
    DEFAULT_GOOGLE_SCRIPT_URL
  ).trim();
}

// 1. GET: Top 3 랭킹 조회
export async function GET() {
  const scriptUrl = getGoogleScriptUrl();

  if (scriptUrl) {
    try {
      const res = await fetch(scriptUrl, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        redirect: "follow",
      });

      if (res.ok) {
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          console.warn("[API/scores] Google response not json:", text);
        }

        const list = Array.isArray(json) ? json : json?.data || [];

        if (Array.isArray(list) && list.length > 0) {
          const sorted = list
            .map((item: any) => {
              let sec = Number(item.timeSeconds);
              if (isNaN(sec) || sec === 0) {
                const timeStr = String(item.finishtime || item.timeFormatted || "");
                const minMatch = timeStr.match(/(\d+)\s*분/);
                const secMatch = timeStr.match(/(\d+)\s*초/);
                const m = minMatch ? parseInt(minMatch[1], 10) : 0;
                const s = secMatch ? parseInt(secMatch[1], 10) : 0;
                sec = m * 60 + s;
              }
              return {
                name: item.name || "익명",
                timeSeconds: sec,
                timeFormatted: item.finishtime || item.timeFormatted || `${Math.floor(sec / 60)}분 ${sec % 60}초`,
                createdAt: item.timestamp || item.createdAt || "",
              };
            })
            .sort((a: ScoreRecord, b: ScoreRecord) => a.timeSeconds - b.timeSeconds)
            .slice(0, 3);

          return NextResponse.json({ scores: sorted, source: "google_sheet" });
        }
      }
    } catch (err) {
      console.error("[API/scores] Google Apps Script GET failed:", err);
    }
  }

  const scores = getLocalScores().slice(0, 3);
  return NextResponse.json({ scores, source: "local" });
}

// 2. POST: 점수 저장
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, timeSeconds, timeFormatted } = body;

    if (!name || typeof timeSeconds !== "number") {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const timestamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    const formatted = timeFormatted || `${Math.floor(timeSeconds / 60)}분 ${Math.floor(timeSeconds % 60)}초`;

    const newRecord: ScoreRecord = {
      name: name.trim(),
      timeSeconds,
      timeFormatted: formatted,
      createdAt: timestamp,
    };

    saveLocalScore(newRecord);

    const scriptUrl = getGoogleScriptUrl();
    let googleSyncSuccess = false;
    let googleError = null;

    if (scriptUrl) {
      try {
        const res = await fetch(scriptUrl, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=utf-8",
          },
          body: JSON.stringify({
            action: "create",
            timestamp: timestamp,
            name: newRecord.name,
            finishtime: formatted,
            timeSeconds: timeSeconds,
          }),
          redirect: "follow",
        });

        const resText = await res.text();
        if (res.ok) {
          googleSyncSuccess = true;
        } else {
          googleError = `HTTP ${res.status}: ${resText}`;
        }
      } catch (err: any) {
        googleError = err.message || String(err);
      }
    }

    return NextResponse.json({
      success: true,
      syncedWithGoogle: googleSyncSuccess,
      hasScriptUrl: Boolean(scriptUrl),
      googleError,
    });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
