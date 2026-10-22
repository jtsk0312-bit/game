"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import { soundManager } from "@/utils/sound";

const GOOGLE_SCRIPT_FALLBACK_URL =
  "https://script.google.com/macros/s/AKfycbxYvQZiKGNf5_qHKXAq8w_wf4W-ALFsWe0WfyJSc9lyWKYYrB4hlW6GBVOv3u4pj1Kf/exec";

// 벽돌 색상 정의 (라이트 모드 파스텔 톤)
const BRICK_COLORS = {
  LIGHT_RED: "#fca5a5",     // 연한 빨강 (목표 대상)
  LIGHT_ORANGE: "#fed7aa",  // 연한 주황
  LIGHT_YELLOW: "#fef08a",  // 연한 노랑
  LIGHT_GREEN: "#bbf7d0",   // 연한 녹색
  LIGHT_BLUE: "#bae6fd",    // 연한 파랑
  LIGHT_PURPLE: "#e9d5ff",  // 연한 보라
};

const COLOR_KEYS = [
  "LIGHT_ORANGE",
  "LIGHT_YELLOW",
  "LIGHT_GREEN",
  "LIGHT_BLUE",
  "LIGHT_PURPLE",
] as const;

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  isRed: boolean;
  intact: boolean;
}

interface ScoreRecord {
  name: string;
  timeSeconds: number;
  timeFormatted: string;
  createdAt?: string;
}

type GameState = "START" | "COUNTDOWN" | "PLAYING" | "PAUSED" | "SUCCESS" | "GAMEOVER";

export default function BrickBreakerGame() {
  const [userName, setUserName] = useState("");
  const [gameState, setGameState] = useState<GameState>("START");
  const [countdown, setCountdown] = useState<number>(3);
  const [lives, setLives] = useState<number>(3);
  const [redCleared, setRedCleared] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [topScores, setTopScores] = useState<ScoreRecord[]>([]);
  const [isLoadingScores, setIsLoadingScores] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 게임 가상 해상도 기준
  const V_WIDTH = 800;
  const V_HEIGHT = 600;

  // 패들 & 공 & 벽돌 상태 refs
  const paddleRef = useRef({
    x: 350,
    y: 550,
    width: 110,
    height: 16,
    speed: 8,
    dx: 0,
  });

  const ballRef = useRef({
    x: 400,
    y: 530,
    radius: 9,
    dx: 2.26,
    dy: -2.26,
    speed: 3.2,
  });

  const bricksRef = useRef<Brick[]>([]);
  const redClearedRef = useRef(0);
  const livesRef = useRef(3);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; paddleX: number } | null>(null);

  // 시간 포맷 함수 (분:초 형식)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}분 ${secs < 10 ? "0" : ""}${secs}초`;
  };

  const getGoogleScriptUrl = () => {
    return (
      process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL ||
      GOOGLE_SCRIPT_FALLBACK_URL
    ).trim();
  };

  // 랭킹 불러오기 (우선 Next.js API 시도 -> 실패시 구글 앱스 스크립트 직접 호출)
  const fetchTopScores = useCallback(async () => {
    setIsLoadingScores(true);
    try {
      // 1. 내부 API 시도
      const res = await fetch("/api/scores", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.scores && data.scores.length > 0) {
          setTopScores(data.scores);
          setIsLoadingScores(false);
          return;
        }
      }
    } catch (e) {
      console.warn("API route fetch failed, trying direct Google Script fetch:", e);
    }

    // 2. 브라우저에서 구글 앱스 스크립트 직접 조회 (Vercel 환경 안전망)
    try {
      const scriptUrl = getGoogleScriptUrl();
      if (scriptUrl) {
        const res = await fetch(scriptUrl, { method: "GET" });
        if (res.ok) {
          const json = await res.json();
          const list = Array.isArray(json) ? json : json?.data || [];
          if (Array.isArray(list) && list.length > 0) {
            const sorted = list
              .map((item: any) => {
                let sec = Number(item.timeSeconds);
                if (isNaN(sec) || sec === 0) {
                  const timeStr = String(item.finishtime || "");
                  const minMatch = timeStr.match(/(\d+)\s*분/);
                  const secMatch = timeStr.match(/(\d+)\s*초/);
                  const m = minMatch ? parseInt(minMatch[1], 10) : 0;
                  const s = secMatch ? parseInt(secMatch[1], 10) : 0;
                  sec = m * 60 + s;
                }
                return {
                  name: item.name || "익명",
                  timeSeconds: sec,
                  timeFormatted: item.finishtime || `${Math.floor(sec / 60)}분 ${sec % 60}초`,
                  createdAt: item.timestamp || "",
                };
              })
              .sort((a: ScoreRecord, b: ScoreRecord) => a.timeSeconds - b.timeSeconds)
              .slice(0, 3);
            setTopScores(sorted);
          }
        }
      }
    } catch (err) {
      console.error("Direct fetch failed:", err);
    } finally {
      setIsLoadingScores(false);
    }
  }, []);

  useEffect(() => {
    fetchTopScores();
  }, [fetchTopScores]);

  // 벽돌 그리드 초기화 (5행 x 8열 = 40개, 30% 연한 빨강)
  const initBricks = () => {
    const rows = 5;
    const cols = 8;
    const totalBricks = rows * cols;
    const redCount = Math.round(totalBricks * 0.3);

    const isRedArr: boolean[] = Array(totalBricks).fill(false);
    for (let i = 0; i < redCount; i++) {
      isRedArr[i] = true;
    }
    for (let i = isRedArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [isRedArr[i], isRedArr[j]] = [isRedArr[j], isRedArr[i]];
    }

    const paddingX = 40;
    const paddingTop = 50;
    const brickSpacing = 10;
    const brickWidth = (V_WIDTH - paddingX * 2 - brickSpacing * (cols - 1)) / cols;
    const brickHeight = 24;

    const newBricks: Brick[] = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isRed = isRedArr[idx++];
        let color = BRICK_COLORS.LIGHT_RED;
        if (!isRed) {
          const randColorKey = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
          color = BRICK_COLORS[randColorKey];
        }

        newBricks.push({
          x: paddingX + c * (brickWidth + brickSpacing),
          y: paddingTop + r * (brickHeight + brickSpacing),
          w: brickWidth,
          h: brickHeight,
          color,
          isRed,
          intact: true,
        });
      }
    }
    bricksRef.current = newBricks;
    redClearedRef.current = 0;
    setRedCleared(0);
  };

  const resetBallAndPaddle = () => {
    paddleRef.current.x = (V_WIDTH - paddleRef.current.width) / 2;
    paddleRef.current.dx = 0;
    ballRef.current.x = V_WIDTH / 2;
    ballRef.current.y = paddleRef.current.y - 18;
    const angle = (Math.random() * 0.4 - 0.2) + -Math.PI / 2;
    const speed = ballRef.current.speed;
    ballRef.current.dx = speed * Math.cos(angle);
    ballRef.current.dy = speed * Math.sin(angle);
  };

  const handleStartGame = () => {
    if (!userName.trim()) {
      alert("사용자 이름을 입력해주세요!");
      return;
    }
    livesRef.current = 3;
    setLives(3);
    setElapsedSeconds(0);
    initBricks();
    resetBallAndPaddle();

    setGameState("COUNTDOWN");
    setCountdown(3);

    soundManager.startBgm();

    let currentCount = 3;
    const countTimer = setInterval(() => {
      currentCount -= 1;
      if (currentCount > 0) {
        setCountdown(currentCount);
      } else {
        clearInterval(countTimer);
        setGameState("PLAYING");
        startTimer();
      }
    }, 1000);
  };

  const startTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const handleTogglePause = () => {
    if (gameState === "PLAYING") {
      setGameState("PAUSED");
      stopTimer();
      soundManager.pauseBgm();
    } else if (gameState === "PAUSED") {
      setGameState("PLAYING");
      startTimer();
      soundManager.resumeBgm();
    }
  };

  const handleRestartToHome = () => {
    stopTimer();
    soundManager.stopBgm();
    setGameState("START");
    setElapsedSeconds(0);
    setRedCleared(0);
    fetchTopScores();
  };

  // 미션 성공 처리 및 2중 전송 보장
  const handleSuccess = useCallback(async () => {
    stopTimer();
    setGameState("SUCCESS");
    soundManager.stopBgm();
    soundManager.playVictorySound();

    try {
      const end = Date.now() + 3 * 1000;
      const colors = ["#f87171", "#38bdf8", "#34d399", "#fbbf24", "#c084fc"];
      (function frame() {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: colors,
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: colors,
        });
        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      })();
    } catch (e) {
      console.error("Confetti error:", e);
    }

    const currentSeconds = elapsedSeconds;
    const formatted = formatTime(currentSeconds);
    const timestamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

    // 구글 시트로 1회만 정확히 전송 (브라우저 직접 no-cors 전송)
    try {
      const scriptUrl = getGoogleScriptUrl();
      if (scriptUrl) {
        await fetch(scriptUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            action: "create",
            timestamp: timestamp,
            name: userName.trim(),
            finishtime: formatted,
            timeSeconds: currentSeconds,
          }),
          mode: "no-cors",
        });
      }
    } catch (err) {
      console.error("Direct post to Google Script failed:", err);
    }

    // 1초 뒤 최신 랭킹 자동 리프레시
    setTimeout(() => {
      fetchTopScores();
    }, 1200);
  }, [elapsedSeconds, userName, fetchTopScores]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "Left") {
        paddleRef.current.dx = -paddleRef.current.speed;
      } else if (e.key === "ArrowRight" || e.key === "Right") {
        paddleRef.current.dx = paddleRef.current.speed;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        (e.key === "ArrowLeft" || e.key === "Left") &&
        paddleRef.current.dx < 0
      ) {
        paddleRef.current.dx = 0;
      } else if (
        (e.key === "ArrowRight" || e.key === "Right") &&
        paddleRef.current.dx > 0
      ) {
        paddleRef.current.dx = 0;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      touchStartRef.current = {
        x: touch.clientX,
        paddleX: paddleRef.current.x,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!touchStartRef.current || e.touches.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = V_WIDTH / rect.width;
    const touch = e.touches[0];
    const diffX = (touch.clientX - touchStartRef.current.x) * scaleX;

    let newX = touchStartRef.current.paddleX + diffX;
    if (newX < 0) newX = 0;
    if (newX + paddleRef.current.width > V_WIDTH) {
      newX = V_WIDTH - paddleRef.current.width;
    }
    paddleRef.current.x = newX;
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  // 게임 루프
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isRunning = true;

    const gameLoop = () => {
      if (!isRunning) return;

      // 배경
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, V_WIDTH, V_HEIGHT);

      ctx.strokeStyle = "rgba(226, 232, 240, 0.4)";
      ctx.lineWidth = 1;
      for (let x = 40; x < V_WIDTH; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, V_HEIGHT);
        ctx.stroke();
      }
      for (let y = 40; y < V_HEIGHT; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(V_WIDTH, y);
        ctx.stroke();
      }

      if (gameState === "PLAYING") {
        const paddle = paddleRef.current;
        const ball = ballRef.current;

        paddle.x += paddle.dx;
        if (paddle.x < 0) paddle.x = 0;
        if (paddle.x + paddle.width > V_WIDTH) {
          paddle.x = V_WIDTH - paddle.width;
        }

        ball.x += ball.dx;
        ball.y += ball.dy;

        if (ball.x - ball.radius < 0) {
          ball.x = ball.radius;
          ball.dx = -ball.dx;
          soundManager.playPaddleSound();
        } else if (ball.x + ball.radius > V_WIDTH) {
          ball.x = V_WIDTH - ball.radius;
          ball.dx = -ball.dx;
          soundManager.playPaddleSound();
        }

        if (ball.y - ball.radius < 0) {
          ball.y = ball.radius;
          ball.dy = -ball.dy;
          soundManager.playPaddleSound();
        }

        // 패들 충돌
        if (
          ball.y + ball.radius >= paddle.y &&
          ball.y - ball.radius <= paddle.y + paddle.height &&
          ball.x + ball.radius >= paddle.x &&
          ball.x - ball.radius <= paddle.x + paddle.width &&
          ball.dy > 0
        ) {
          const hitPos = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
          const maxBounceAngle = Math.PI / 3;
          const bounceAngle = hitPos * maxBounceAngle;

          const currentSpeed = Math.sqrt(ball.dx * ball.dx + ball.dy * ball.dy);
          ball.dx = currentSpeed * Math.sin(bounceAngle);
          ball.dy = -currentSpeed * Math.cos(bounceAngle);
          ball.y = paddle.y - ball.radius;
          soundManager.playPaddleSound();
        }

        // 블록 충돌
        for (let i = 0; i < bricksRef.current.length; i++) {
          const b = bricksRef.current[i];
          if (!b.intact) continue;

          const nearestX = Math.max(b.x, Math.min(ball.x, b.x + b.w));
          const nearestY = Math.max(b.y, Math.min(ball.y, b.y + b.h));
          const distX = ball.x - nearestX;
          const distY = ball.y - nearestY;
          const distance = Math.sqrt(distX * distX + distY * distY);

          if (distance < ball.radius) {
            b.intact = false;
            soundManager.playHitSound(b.isRed);

            const overlapX = ball.radius - Math.abs(distX);
            const overlapY = ball.radius - Math.abs(distY);

            if (overlapX < overlapY) {
              ball.dx = -ball.dx;
            } else {
              ball.dy = -ball.dy;
            }

            if (b.isRed) {
              redClearedRef.current += 1;
              const newCleared = redClearedRef.current;
              setRedCleared(newCleared);

              if (newCleared >= 3) {
                handleSuccess();
                return;
              }
            }
            break;
          }
        }

        // 바닥 추락
        if (ball.y - ball.radius > V_HEIGHT) {
          soundManager.playLoseLifeSound();
          livesRef.current -= 1;
          const currentLives = livesRef.current;
          setLives(currentLives);

          if (currentLives <= 0) {
            stopTimer();
            soundManager.stopBgm();
            setGameState("GAMEOVER");
            return;
          } else {
            resetBallAndPaddle();
          }
        }
      }

      // 렌더링
      bricksRef.current.forEach((b) => {
        if (!b.intact) return;
        ctx.save();
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      });

      const paddle = paddleRef.current;
      ctx.save();
      const pGrad = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x, paddle.y + paddle.height);
      pGrad.addColorStop(0, "#0284c7");
      pGrad.addColorStop(1, "#0369a1");
      ctx.fillStyle = pGrad;
      ctx.beginPath();
      ctx.roundRect(paddle.x, paddle.y, paddle.width, paddle.height, 8);
      ctx.fill();
      ctx.shadowColor = "rgba(2, 132, 199, 0.35)";
      ctx.shadowBlur = 8;
      ctx.restore();

      const ball = ballRef.current;
      ctx.save();
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
      ctx.shadowBlur = 4;
      ctx.restore();

      if (gameState === "COUNTDOWN") {
        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
        ctx.font = "bold 84px sans-serif";
        ctx.fillStyle = "#0284c7";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${countdown}`, V_WIDTH / 2, V_HEIGHT / 2);
      }

      if (gameState === "PAUSED") {
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
        ctx.font = "bold 36px sans-serif";
        ctx.fillStyle = "#334155";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⏸ 게임 일시 정지", V_WIDTH / 2, V_HEIGHT / 2);
      }

      animFrameIdRef.current = requestAnimationFrame(gameLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(gameLoop);

    return () => {
      isRunning = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [gameState, handleSuccess, countdown]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-slate-100 text-slate-800 flex flex-col items-center justify-start p-4 select-none">
      <header className="w-full max-w-4xl py-3 flex items-center justify-between border-b border-slate-200 mb-3">
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 rounded-xl overflow-hidden border border-sky-200 shadow-sm bg-white flex items-center justify-center">
            <Image
              src="/Mascot.jpg"
              alt="INU 마스코트"
              fill
              className="object-cover"
              priority
            />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-sky-800 flex items-center gap-2">
              INU 벽돌깨기
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200">
                인천대학교
              </span>
            </h1>
          </div>
        </div>
      </header>

      {gameState !== "START" && (
        <div className="w-full max-w-[800px] flex flex-wrap items-center justify-between bg-white border border-slate-200 border-b-0 px-4 py-2.5 rounded-t-2xl gap-2 shadow-sm">
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-slate-700">
              플레이어: <span className="text-sky-600 font-bold">{userName}</span>
            </span>
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500 font-medium mr-1">생명:</span>
              {[...Array(3)].map((_, i) => (
                <span
                  key={i}
                  className={`text-lg transition-transform ${
                    i < lives ? "opacity-100 scale-100" : "opacity-20 scale-75 grayscale"
                  }`}
                >
                  ❤️
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-slate-700">
              빨강 블록:{" "}
              <span className="text-rose-500 font-extrabold text-base">
                {redCleared}
              </span>
              <span className="text-slate-400"> / 3</span>
            </div>
            <div className="text-sm font-mono bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-200 text-sky-800 font-bold">
              ⏱ {formatTime(elapsedSeconds)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(gameState === "PLAYING" || gameState === "PAUSED") && (
              <button
                onClick={handleTogglePause}
                className="px-3 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition"
              >
                {gameState === "PAUSED" ? "▶ 계속하기" : "⏸ 멈춤"}
              </button>
            )}
            <button
              onClick={handleRestartToHome}
              className="px-3 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition"
            >
              다시 시작
            </button>
          </div>
        </div>
      )}

      <div className="relative w-full max-w-[800px] aspect-[4/3] bg-white rounded-2xl overflow-hidden shadow-lg border border-slate-200">
        <canvas
          ref={canvasRef}
          width={V_WIDTH}
          height={V_HEIGHT}
          className="w-full h-full block touch-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />

        {gameState === "START" && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-between p-6 sm:p-8 text-center z-20">
            <div className="flex flex-col items-center mt-2">
              <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden border-2 border-sky-300 shadow-md mb-3 bg-white">
                <Image
                  src="/Mascot.jpg"
                  alt="INU 마스코트"
                  fill
                  className="object-contain p-1"
                  priority
                />
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-sky-900 mb-1">
                INU 벽돌깨기 챌린지
              </h2>
              <p className="text-slate-600 text-xs sm:text-sm max-w-md leading-relaxed">
                파스텔 블록 속에 숨어있는 <span className="text-rose-500 font-bold">연한 빨강 블록 3개</span>를 타격하세요!
              </p>
            </div>

            <div className="w-full max-w-xs flex flex-col gap-2.5 my-2">
              <input
                type="text"
                placeholder="플레이어 이름을 입력하세요"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                maxLength={12}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 text-center font-semibold text-sm shadow-inner"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleStartGame();
                }}
              />
              <button
                onClick={handleStartGame}
                className="w-full py-3 px-6 rounded-xl font-bold text-sm bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-500/30 transition active:scale-95 flex items-center justify-center gap-2"
              >
                🎮 게임 시작하기
              </button>
            </div>

            <div className="w-full max-w-sm flex flex-col items-center gap-3">
              <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 shadow-sm text-left">
                <div className="text-xs font-bold text-amber-700 mb-1.5 flex items-center justify-between">
                  <span>🏆 명예의 전당 Top 3</span>
                  <span className="text-[11px] font-normal text-slate-400">클리어 소요 시간</span>
                </div>
                {isLoadingScores ? (
                  <div className="text-xs text-slate-400 text-center py-1">불러오는 중...</div>
                ) : topScores.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-1">첫 번째 주인공이 되어보세요!</div>
                ) : (
                  <div className="space-y-1">
                    {topScores.map((score, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center text-xs py-1 px-2.5 rounded-lg bg-white border border-slate-100 font-medium"
                      >
                        <span className="text-slate-700">
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"} {score.name}
                        </span>
                        <span className="font-mono text-sky-700 font-bold">
                          {score.timeFormatted}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-xs sm:text-sm font-semibold text-slate-600 tracking-wide py-1 px-3 rounded-full bg-slate-100 border border-slate-200">
                경영학부 202502453 정채린
              </div>
            </div>
          </div>
        )}

        {gameState === "SUCCESS" && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20">
            <div className="text-6xl mb-2 animate-bounce">🎉</div>
            <h2 className="text-3xl font-black text-sky-800 mb-1">
              미션 성공!
            </h2>
            <p className="text-slate-600 text-sm mb-4">
              연한 빨강 블록 3개를 완벽하게 제거했습니다!
            </p>

            <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 mb-5 w-full max-w-xs shadow-sm">
              <div className="text-xs font-medium text-slate-500 mb-1">플레이어</div>
              <div className="text-lg font-bold text-sky-800 mb-2">{userName}</div>
              <div className="text-xs font-medium text-slate-500 mb-1">클리어 완료 시간</div>
              <div className="text-2xl font-mono font-extrabold text-sky-600">
                {formatTime(elapsedSeconds)}
              </div>
            </div>

            <button
              onClick={handleRestartToHome}
              className="py-3 px-6 rounded-xl font-bold text-sm bg-sky-600 hover:bg-sky-500 text-white shadow-md transition active:scale-95"
            >
              다시 시작 (이름 변경)
            </button>
          </div>
        )}

        {gameState === "GAMEOVER" && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20">
            <div className="text-6xl mb-2">💥</div>
            <h2 className="text-3xl font-black text-rose-600 mb-1">
              게임 미션 실패
            </h2>
            <p className="text-slate-500 text-sm max-w-xs mb-5">
              공을 놓쳐 생명이 모두 소진되었습니다.
            </p>

            <button
              onClick={handleRestartToHome}
              className="py-3 px-6 rounded-xl font-bold text-sm bg-slate-800 hover:bg-slate-700 text-white shadow-md transition active:scale-95"
            >
              다시 시작 (이름 변경)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
