
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameStage, Participant, GameState, Match, Card, RPSChoice, RoomMode } from './types';
import { getMCCommentary } from './services/geminiService';
import MCPanel from './components/MCPanel';
import {
  generateRoomId,
  createRoom,
  checkRoomExists,
  syncGameState,
  syncMatchView,
  subscribeToRoom,
  type MatchViewState,
} from './services/gameSync';

const SUITS: { symbol: '♠' | '♥' | '♦' | '♣', val: number }[] = [
  { symbol: '♠', val: 4 },
  { symbol: '♥', val: 3 },
  { symbol: '♦', val: 2 },
  { symbol: '♣', val: 1 }
];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const initialMatchView = {
  p1Hand: [] as Card[],
  p2Hand: [] as Card[],
  p1Score: 0,
  p2Score: 0,
  p1Choice: null as RPSChoice,
  p2Choice: null as RPSChoice,
  status: 'IDLE' as const,
  roundMessage: "",
  deck: [] as Card[],
  currentPlayer: 1 as const,
  p1Passed: false,
  p2Passed: false,
  p1Dice: [] as number[],
  p2Dice: [] as number[],
  p1DiceResult: '',
  p2DiceResult: '',
};

// 預設參賽者名單
const defaultParticipants: Participant[] = [
  { id: 'p1', name: '阿公' },
  { id: 'p2', name: '阿嬤' },
  { id: 'p3', name: '哲誠' },
  { id: 'p4', name: '姿瑤' },
  { id: 'p5', name: '宣澐' },
  { id: 'p6', name: '宣綾' },
  { id: 'p7', name: '鼎誠' },
  { id: 'p8', name: '小雯' },
  { id: 'p9', name: '品言' },
  { id: 'p10', name: '懋鑫' },
  { id: 'p11', name: '雅婷' },
  { id: 'p12', name: '昱愷' },
  { id: 'p13', name: '昱豪' },
];

const initialGameState: GameState = {
  stage: GameStage.SETUP,
  roundNumber: 0,
  allParticipants: defaultParticipants,
  currentPool: [],
  matches: [],
  currentMatchIndex: 0,
  winnersOfRound: [],
  mcCommentary: "歡迎來到尾牙競技場！請輸入參加者，準備開始刺激的巔峰對決！",
  isSimulating: false,
  finalWinner: null,
};

const App: React.FC = () => {
  // 房間狀態
  const [roomMode, setRoomMode] = useState<RoomMode>('selecting');
  const [roomId, setRoomId] = useState<string>('');
  const [joinRoomInput, setJoinRoomInput] = useState<string>('');
  const [roomError, setRoomError] = useState<string>('');
  const [hostDisconnected, setHostDisconnected] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const [gameState, setGameState] = useState<GameState>(initialGameState);

  const [newName, setNewName] = useState("");
  const [matchView, setMatchView] = useState<typeof initialMatchView>(initialMatchView);
  const matchViewRef = useRef(matchView);

  // 使用 ref 來保存最新的 roomId 和 roomMode，解決閉包問題
  const roomIdRef = useRef(roomId);
  const roomModeRef = useRef(roomMode);

  // 每次 roomId 或 roomMode 變化時更新 ref
  useEffect(() => {
    roomIdRef.current = roomId;
    roomModeRef.current = roomMode;
  }, [roomId, roomMode]);

  // 保持 matchViewRef 與 matchView 同步
  useEffect(() => {
    matchViewRef.current = matchView;
  }, [matchView]);

  // 直接同步到 Firebase 的函數
  const syncViewDirectly = async (view: typeof initialMatchView) => {
    const currentRoomId = roomIdRef.current;
    const currentRoomMode = roomModeRef.current;
    if (currentRoomMode === 'host' && currentRoomId) {
      // Firebase 不接受 undefined，所有欄位都必須有預設值
      const viewForSync: MatchViewState = {
        p1Hand: view.p1Hand || [],
        p2Hand: view.p2Hand || [],
        p1Score: view.p1Score ?? 0,
        p2Score: view.p2Score ?? 0,
        p1Choice: view.p1Choice ?? null,
        p2Choice: view.p2Choice ?? null,
        status: view.status || 'IDLE',
        roundMessage: view.roundMessage || '',
        currentPlayer: view.currentPlayer ?? 1,
        p1Passed: view.p1Passed ?? false,
        p2Passed: view.p2Passed ?? false,
        p1Dice: view.p1Dice || [],
        p2Dice: view.p2Dice || [],
        p1DiceResult: view.p1DiceResult || '',
        p2DiceResult: view.p2DiceResult || '',
      };
      try {
        await syncMatchView(currentRoomId, viewForSync);
      } catch (err) {
        console.error('Failed to sync match view:', err);
      }
    }
  };

  // 更新 matchView 並立即同步到 Firebase（用於遊戲動畫）
  const updateAndSyncMatchView = async (updater: ((prev: typeof initialMatchView) => typeof initialMatchView) | typeof initialMatchView) => {
    const currentView = matchViewRef.current;
    const newView = typeof updater === 'function' ? updater(currentView) : updater;
    matchViewRef.current = newView;
    setMatchView(newView);
    // 使用 ref 來獲取最新的值
    await syncViewDirectly(newView);
  };

  // 保持舊的 flushMatchViewToFirebase 以兼容現有代碼
  const flushMatchViewToFirebase = async () => {
    await syncViewDirectly(matchViewRef.current);
  };

  // 同步遊戲狀態到 Firebase（主持人專用）
  const syncState = useCallback(async (state: GameState) => {
    if (roomMode === 'host' && roomId) {
      try {
        await syncGameState(roomId, state);
      } catch (err) {
        console.error('Failed to sync game state:', err);
      }
    }
  }, [roomMode, roomId]);

  // 同步比賽視圖到 Firebase（主持人專用）
  const syncView = useCallback(async (view: MatchViewState) => {
    if (roomMode === 'host' && roomId) {
      try {
        await syncMatchView(roomId, view);
      } catch (err) {
        console.error('Failed to sync match view:', err);
      }
    }
  }, [roomMode, roomId]);

  // 主持人建立房間
  const handleCreateRoom = async () => {
    const newRoomId = generateRoomId();
    setRoomId(newRoomId);
    setRoomError('');

    try {
      const matchViewForSync: MatchViewState = {
        p1Hand: initialMatchView.p1Hand,
        p2Hand: initialMatchView.p2Hand,
        p1Score: initialMatchView.p1Score,
        p2Score: initialMatchView.p2Score,
        p1Choice: initialMatchView.p1Choice,
        p2Choice: initialMatchView.p2Choice,
        status: initialMatchView.status,
        roundMessage: initialMatchView.roundMessage,
        currentPlayer: initialMatchView.currentPlayer,
        p1Passed: initialMatchView.p1Passed,
        p2Passed: initialMatchView.p2Passed,
        p1Dice: initialMatchView.p1Dice,
        p2Dice: initialMatchView.p2Dice,
        p1DiceResult: initialMatchView.p1DiceResult,
        p2DiceResult: initialMatchView.p2DiceResult,
      };
      await createRoom(newRoomId, initialGameState, matchViewForSync);
      setRoomMode('host');
    } catch (err) {
      setRoomError('建立房間失敗，請檢查網路連線或 Firebase 設定');
      console.error(err);
    }
  };

  // 觀眾加入房間
  const handleJoinRoom = async () => {
    const code = joinRoomInput.toUpperCase().trim();
    if (code.length !== 6) {
      setRoomError('請輸入 6 位數房間代碼');
      return;
    }

    setRoomError('');

    try {
      const exists = await checkRoomExists(code);
      if (!exists) {
        setRoomError('房間不存在，請確認代碼是否正確');
        return;
      }

      setRoomId(code);
      setRoomMode('viewer');

      // 訂閱房間狀態
      const unsubscribe = subscribeToRoom(
        code,
        (newGameState) => {
          setGameState(newGameState);
        },
        (newMatchView) => {
          // 確保陣列類型的資料被正確處理（Firebase 可能將空陣列轉為 undefined）
          const updatedView = {
            ...initialMatchView,
            ...newMatchView,
            p1Hand: newMatchView.p1Hand || [],
            p2Hand: newMatchView.p2Hand || [],
            p1Dice: newMatchView.p1Dice || [],
            p2Dice: newMatchView.p2Dice || [],
          };
          matchViewRef.current = updatedView;
          setMatchView(updatedView);
        },
        () => {
          setHostDisconnected(true);
        }
      );

      unsubscribeRef.current = unsubscribe;
    } catch (err) {
      setRoomError('加入房間失敗，請檢查網路連線');
      console.error(err);
    }
  };

  // 離開房間
  const handleLeaveRoom = () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setRoomMode('selecting');
    setRoomId('');
    setJoinRoomInput('');
    setRoomError('');
    setHostDisconnected(false);
    setGameState(initialGameState);
    setMatchView(initialMatchView);
  };

  // 清理訂閱
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  // 主持人狀態變更時同步
  useEffect(() => {
    if (roomMode === 'host' && roomId) {
      syncState(gameState);
    }
  }, [gameState, roomMode, roomId, syncState]);

  useEffect(() => {
    if (roomMode === 'host' && roomId) {
      const viewForSync: MatchViewState = {
        p1Hand: matchView.p1Hand,
        p2Hand: matchView.p2Hand,
        p1Score: matchView.p1Score,
        p2Score: matchView.p2Score,
        p1Choice: matchView.p1Choice,
        p2Choice: matchView.p2Choice,
        status: matchView.status,
        roundMessage: matchView.roundMessage,
        currentPlayer: matchView.currentPlayer,
        p1Passed: matchView.p1Passed,
        p2Passed: matchView.p2Passed,
        p1Dice: matchView.p1Dice,
        p2Dice: matchView.p2Dice,
        p1DiceResult: matchView.p1DiceResult,
        p2DiceResult: matchView.p2DiceResult,
      };
      syncView(viewForSync);
    }
  }, [matchView, roomMode, roomId, syncView]);

  const updateMC = async (text: string) => {
    const commentary = await getMCCommentary(text);
    setGameState(prev => ({ ...prev, mcCommentary: commentary }));
  };

  const addParticipant = () => {
    if (!newName.trim()) return;
    const p: Participant = { id: Math.random().toString(36).substr(2, 9), name: newName.trim() };
    setGameState(prev => ({ ...prev, allParticipants: [...prev.allParticipants, p] }));
    setNewName("");
  };

  const startTournament = () => {
    if (gameState.allParticipants.length < 2) {
      alert("至少需要 2 位參加者才能開始！");
      return;
    }
    prepareRound(gameState.allParticipants, 1);
  };

  // Fisher-Yates 洗牌演算法，確保真正隨機
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const prepareRound = (pool: Participant[], round: number) => {
    // 使用 Fisher-Yates 洗牌確保每輪都是真正隨機配對
    const shuffled = shuffleArray(pool);
    const matches: Match[] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      matches.push({
        p1: shuffled[i],
        p2: shuffled[i + 1] || null,
        winner: null,
        gameData: { logs: [] }
      });
    }

    setGameState(prev => ({
      ...prev,
      stage: GameStage.ROUND_PREPARING,
      roundNumber: round,
      currentPool: pool,
      matches,
      currentMatchIndex: 0,
      winnersOfRound: [],
      isSimulating: false,
    }));

    const roundName = round === 1 ? "第一關：十八啦" : round === 2 ? "第二關：十點半" : "最終關：撲克對決";
    updateMC(`${roundName} 正式開始！請各位選手準備好！`);
  };

  const createDeck = () => {
    const deck: Card[] = [];
    SUITS.forEach(suit => {
      VALUES.forEach((value, idx) => {
        let points = idx + 1;
        if (value === 'A') points = 1;
        else if (['J', 'Q', 'K'].includes(value)) points = 0.5;
        else points = parseInt(value);

        // 撲克牌 rank: A 是最大的 (14)，其他按順序 2-13
        let rank = idx + 1;
        if (value === 'A') rank = 14; // A 是最大的牌

        deck.push({
          suit: suit.symbol,
          suitValue: suit.val,
          value,
          points,
          rank
        });
      });
    });
    return deck.sort(() => Math.random() - 0.5);
  };

  const playMatch = async () => {
    const match = gameState.matches[gameState.currentMatchIndex];
    if (!match.p2) {
      // Bye round
      const winner = match.p1;
      setGameState(prev => ({
        ...prev,
        winnersOfRound: [...prev.winnersOfRound, winner],
        currentMatchIndex: prev.currentMatchIndex + 1,
        stage: GameStage.ROUND_PREPARING
      }));
      updateMC(`${winner.name} 幸運抽中輪空位，直接晉級！`);
      return;
    }

    setGameState(prev => ({ ...prev, isSimulating: true }));
    setMatchView({ p1Hand: [], p2Hand: [], p1Score: 0, p2Score: 0, p1Choice: null, p2Choice: null, status: 'ACTION', roundMessage: "戰鬥開始！" });

    if (gameState.roundNumber === 1) {
      await simulate18La(match);
    } else if (gameState.roundNumber === 2) {
      await startTenHalfRound2(match);
    } else {
      await simulatePokerShowdown(match);
    }
  };

  // 十八啦骰子遊戲
  const rollDice = (): number[] => {
    return [1, 2, 3, 4].map(() => Math.floor(Math.random() * 6) + 1);
  };

  // 評估十八啦結果
  // 回傳: { rank: 排名分數, points: 點數, name: 牌型名稱, valid: 是否有效 }
  const evaluate18La = (dice: number[]): { rank: number; points: number; name: string; valid: boolean } => {
    const sorted = [...dice].sort((a, b) => a - b);
    const counts: { [key: number]: number } = {};
    dice.forEach(d => counts[d] = (counts[d] || 0) + 1);
    const countValues = Object.values(counts).sort((a, b) => b - a);

    // 一色（豹子）- 四顆相同，最大
    if (countValues[0] === 4) {
      return { rank: 100, points: sorted[0] * 4, name: '一色', valid: true };
    }

    // 十八 - 對子為六 + 另一組對子
    if (countValues[0] === 2 && countValues[1] === 2) {
      const pairs = Object.keys(counts).filter(k => counts[Number(k)] === 2).map(Number);
      if (pairs.includes(6)) {
        return { rank: 99, points: 18, name: '十八', valid: true };
      }
      // 兩對但沒有六，無法成立
      return { rank: -1, points: 0, name: '無效', valid: false };
    }

    // 有一個對子，計算另外兩顆點數
    if (countValues[0] === 2 && countValues.length >= 2) {
      const pairValue = Number(Object.keys(counts).find(k => counts[Number(k)] === 2));
      const others = dice.filter(d => d !== pairValue || (counts[d]-- <= 0 ? false : (counts[d]++, false)));
      // 重新計算 others
      const remaining: number[] = [];
      const tempCounts = { ...counts };
      let pairFound = 0;
      for (const d of dice) {
        if (d === pairValue && pairFound < 2) {
          pairFound++;
        } else {
          remaining.push(d);
        }
      }

      const sum = remaining.reduce((a, b) => a + b, 0);

      // BG - 1+2=3，最小
      if ((remaining[0] === 1 && remaining[1] === 2) || (remaining[0] === 2 && remaining[1] === 1)) {
        return { rank: 0, points: 3, name: 'BG', valid: true };
      }

      return { rank: sum, points: sum, name: `${sum}點`, valid: true };
    }

    // 三條 - 無效（沒有對子可以拿掉）
    if (countValues[0] === 3) {
      return { rank: -1, points: 0, name: '無效', valid: false };
    }

    // 沒有對子 - 無效
    return { rank: -1, points: 0, name: '無效', valid: false };
  };

  const simulate18La = async (match: Match) => {
    updateMC(`第一關：十八啦！${match.p1.name} 與 ${match.p2!.name} 準備擲骰子...`);

    let p1Dice: number[] = [];
    let p2Dice: number[] = [];
    let p1Result = { rank: -1, points: 0, name: '無效', valid: false };
    let p2Result = { rank: -1, points: 0, name: '無效', valid: false };

    // 重擲直到雙方都有效且不平手
    let attempts = 0;
    do {
      attempts++;
      p1Dice = rollDice();
      p2Dice = rollDice();
      p1Result = evaluate18La(p1Dice);
      p2Result = evaluate18La(p2Dice);
    } while (
      (!p1Result.valid || !p2Result.valid || p1Result.rank === p2Result.rank) &&
      attempts < 100
    );

    // 初始化
    await updateAndSyncMatchView(prev => ({
      ...prev,
      p1Score: 0,
      p2Score: 0,
      p1Dice: [],
      p2Dice: [],
      p1DiceResult: '',
      p2DiceResult: '',
      status: 'ACTION',
      roundMessage: `${match.p1.name} 擲骰子...`
    }));

    await new Promise(r => setTimeout(r, 500));

    // P1 擲骰子動畫 - 快速切換隨機數字
    for (let i = 0; i < 10; i++) {
      await updateAndSyncMatchView(prev => ({
        ...prev,
        p1Dice: rollDice(), // 隨機顯示
      }));
      await new Promise(r => setTimeout(r, 100));
    }

    // P1 定格結果
    await updateAndSyncMatchView(prev => ({
      ...prev,
      p1Dice: p1Dice,
      p1DiceResult: p1Result.name,
      roundMessage: `${match.p1.name}【${p1Result.name}】`
    }));

    await new Promise(r => setTimeout(r, 1500));

    // P2 擲骰子
    await updateAndSyncMatchView(prev => ({
      ...prev,
      roundMessage: `${match.p2!.name} 擲骰子...`
    }));

    await new Promise(r => setTimeout(r, 500));

    // P2 擲骰子動畫
    for (let i = 0; i < 10; i++) {
      await updateAndSyncMatchView(prev => ({
        ...prev,
        p2Dice: rollDice(),
      }));
      await new Promise(r => setTimeout(r, 100));
    }

    // P2 定格結果
    await updateAndSyncMatchView(prev => ({
      ...prev,
      p2Dice: p2Dice,
      p2DiceResult: p2Result.name,
      roundMessage: `${match.p2!.name}【${p2Result.name}】`
    }));

    await new Promise(r => setTimeout(r, 1500));

    // 顯示雙方結果比較，等待 5 秒
    await updateAndSyncMatchView(prev => ({
      ...prev,
      roundMessage: `${match.p1.name}【${p1Result.name}】 vs ${match.p2!.name}【${p2Result.name}】`
    }));

    updateMC(`${match.p1.name}【${p1Result.name}】vs ${match.p2!.name}【${p2Result.name}】，請確認點數...`);

    await new Promise(r => setTimeout(r, 5000));

    // 決定勝負
    const winner = p1Result.rank > p2Result.rank ? match.p1 : match.p2!;

    await updateAndSyncMatchView(prev => ({
      ...prev,
      status: 'RESULT',
      roundMessage: `🎉 ${winner.name} 獲勝！🎉`
    }));

    updateMC(`恭喜 ${winner.name} 晉級！`);
    setTimeout(() => finalizeMatch(winner), 3000);
  };

  const startTenHalfRound2 = async (match: Match) => {
    const deck = createDeck();
    updateMC(`第二關十點半！${match.p1.name} 先手，請決定是否補牌...`);

    const c1 = deck.pop()!;
    const c2 = deck.pop()!;

    await updateAndSyncMatchView({
      p1Hand: [c1],
      p2Hand: [c2],
      p1Score: c1.points,
      p2Score: c2.points,
      p1Choice: null,
      p2Choice: null,
      status: 'P1_TURN',
      roundMessage: `${match.p1.name} 的回合`,
      deck: deck,
      currentPlayer: 1,
      p1Passed: false,
      p2Passed: false,
      p1Dice: [],
      p2Dice: [],
      p1DiceResult: '',
      p2DiceResult: '',
    });
  };

  const handleHit = async () => {
    const match = gameState.matches[gameState.currentMatchIndex];
    const currentView = matchViewRef.current;
    const newCard = currentView.deck[currentView.deck.length - 1];
    const newDeck = currentView.deck.slice(0, -1);

    if (currentView.currentPlayer === 1) {
      const newHand = [...currentView.p1Hand, newCard];
      const newScore = newHand.reduce((s, c) => s + c.points, 0);
      const isBust = newScore > 10.5;
      const isFiveCardWin = newHand.length === 5 && !isBust;

      await updateAndSyncMatchView(prev => ({
        ...prev,
        p1Hand: newHand,
        p1Score: newScore,
        deck: newDeck,
        roundMessage: isFiveCardWin
          ? `${match.p1.name} 過五關！${newScore} 點，直接獲勝！`
          : isBust ? `${match.p1.name} 爆掉了！${newScore} 點` : `${match.p1.name} 補牌得到 ${newCard.suit}${newCard.value}`,
      }));

      if (isFiveCardWin) {
        updateMC(`${match.p1.name} 過五關！五張牌 ${newScore} 點沒有爆掉，直接獲勝！`);
        setTimeout(() => determineRound2Winner(match), 2000);
      } else if (isBust) {
        updateMC(`${match.p1.name} 爆掉了！${newScore} 點，換 ${match.p2!.name}！`);
        setTimeout(async () => {
          await updateAndSyncMatchView(prev => ({
            ...prev,
            currentPlayer: 2,
            status: 'P2_TURN',
            p1Passed: true,
            roundMessage: `${match.p2!.name} 的回合`,
          }));
        }, 1500);
      }
    } else {
      const newHand = [...currentView.p2Hand, newCard];
      const newScore = newHand.reduce((s, c) => s + c.points, 0);
      const isBust = newScore > 10.5;
      const isFiveCardWin = newHand.length === 5 && !isBust;

      await updateAndSyncMatchView(prev => ({
        ...prev,
        p2Hand: newHand,
        p2Score: newScore,
        deck: newDeck,
        roundMessage: isFiveCardWin
          ? `${match.p2!.name} 過五關！${newScore} 點，直接獲勝！`
          : isBust ? `${match.p2!.name} 爆掉了！${newScore} 點` : `${match.p2!.name} 補牌得到 ${newCard.suit}${newCard.value}`,
      }));

      if (isFiveCardWin) {
        updateMC(`${match.p2!.name} 過五關！五張牌 ${newScore} 點沒有爆掉，直接獲勝！`);
        setTimeout(() => determineRound2Winner(match), 2000);
      } else if (isBust) {
        updateMC(`${match.p2!.name} 爆掉了！${newScore} 點`);
        setTimeout(() => determineRound2Winner(match), 1500);
      }
    }
  };

  const handlePass = async () => {
    const match = gameState.matches[gameState.currentMatchIndex];
    const currentView = matchViewRef.current;

    if (currentView.currentPlayer === 1) {
      updateMC(`${match.p1.name} 選擇停牌！換 ${match.p2!.name}！`);
      await updateAndSyncMatchView(prev => ({
        ...prev,
        currentPlayer: 2,
        status: 'P2_TURN',
        p1Passed: true,
        roundMessage: `${match.p2!.name} 的回合`,
      }));
    } else {
      updateMC(`${match.p2!.name} 選擇停牌！`);
      await updateAndSyncMatchView(prev => ({
        ...prev,
        p2Passed: true,
      }));
      setTimeout(() => determineRound2Winner(match), 1000);
    }
  };

  const determineRound2Winner = async (match: Match) => {
    const currentView = matchViewRef.current;
    const s1 = currentView.p1Hand.reduce((s, c) => s + c.points, 0);
    const s2 = currentView.p2Hand.reduce((s, c) => s + c.points, 0);
    const p1Bust = s1 > 10.5;
    const p2Bust = s2 > 10.5;
    const p1Five = currentView.p1Hand.length === 5 && !p1Bust;
    const p2Five = currentView.p2Hand.length === 5 && !p2Bust;

    let winner: Participant | null = null;

    if (p1Five && !p2Five) winner = match.p1;
    else if (!p1Five && p2Five) winner = match.p2!;
    else if (p1Bust && !p2Bust) winner = match.p2!;
    else if (!p1Bust && p2Bust) winner = match.p1;
    else if (p1Bust && p2Bust) {
      // 都爆掉，平手重賽
      winner = null;
    }
    else if (s1 > s2) winner = match.p1;
    else if (s2 > s1) winner = match.p2!;
    else winner = null; // 同分，重賽

    // 同分時重新開始十點半
    if (winner === null) {
      await updateAndSyncMatchView(prev => ({ ...prev, status: 'RESULT', roundMessage: `平手！${s1} 點 vs ${s2} 點，重新比賽！` }));
      updateMC(`${match.p1.name} ${s1} 點 vs ${match.p2!.name} ${s2} 點，平手！重新發牌！`);
      setTimeout(() => startTenHalfRound2(match), 3000);
      return;
    }

    await updateAndSyncMatchView(prev => ({ ...prev, status: 'RESULT', roundMessage: `🎉 ${winner.name} 獲勝！🎉` }));
    updateMC(`${match.p1.name} ${s1} 點 vs ${match.p2!.name} ${s2} 點。恭喜 ${winner.name} 晉級！`);
    setTimeout(() => finalizeMatch(winner), 3000);
  };

  // 牌型名稱
  const HAND_NAMES = ['散牌', '一對', '兩對', '三條', '順子', '同花', '葫蘆', '鐵支', '同花順'];

  // 評估牌型，回傳 [牌型等級, 比較用數值陣列]
  const evaluatePokerHand = (hand: Card[]): { rank: number; values: number[]; name: string } => {
    const sorted = [...hand].sort((a, b) => b.rank - a.rank);
    const ranks = sorted.map(c => c.rank);
    const suits = sorted.map(c => c.suit);

    // 計算每個點數出現次數
    const rankCounts: { [key: number]: number } = {};
    ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const uniqueRanks = Object.keys(rankCounts).map(Number).sort((a, b) => {
      // 先按出現次數排序，次數相同按點數大小排序
      if (rankCounts[b] !== rankCounts[a]) return rankCounts[b] - rankCounts[a];
      return b - a;
    });

    // 檢查同花
    const isFlush = suits.every(s => s === suits[0]);

    // 檢查順子 (包含 A-2-3-4-5 和 10-J-Q-K-A)
    // A 的 rank 是 14，所以：
    // - A-2-3-4-5 (最小順子): [14, 5, 4, 3, 2]
    // - 10-J-Q-K-A (最大順子): [14, 13, 12, 11, 10]
    const isLowStraight = ranks.join(',') === '14,5,4,3,2';
    const isHighStraight = ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5;
    const straightCheck = isLowStraight || isHighStraight;

    // 同花順
    if (isFlush && straightCheck) {
      const highCard = isLowStraight ? 5 : ranks[0];
      return { rank: 8, values: [highCard], name: '同花順' };
    }

    // 鐵支 (四條)
    if (counts[0] === 4) {
      return { rank: 7, values: uniqueRanks, name: '鐵支' };
    }

    // 葫蘆
    if (counts[0] === 3 && counts[1] === 2) {
      return { rank: 6, values: uniqueRanks, name: '葫蘆' };
    }

    // 同花
    if (isFlush) {
      return { rank: 5, values: ranks, name: '同花' };
    }

    // 順子
    if (straightCheck) {
      const highCard = isLowStraight ? 5 : ranks[0];
      return { rank: 4, values: [highCard], name: '順子' };
    }

    // 三條
    if (counts[0] === 3) {
      return { rank: 3, values: uniqueRanks, name: '三條' };
    }

    // 兩對
    if (counts[0] === 2 && counts[1] === 2) {
      return { rank: 2, values: uniqueRanks, name: '兩對' };
    }

    // 一對
    if (counts[0] === 2) {
      return { rank: 1, values: uniqueRanks, name: '一對' };
    }

    // 散牌
    return { rank: 0, values: ranks, name: '散牌' };
  };

  // 比較兩手牌，回傳 1 表示 hand1 勝，-1 表示 hand2 勝，0 表示平手
  const compareHands = (hand1: Card[], hand2: Card[]): number => {
    const eval1 = evaluatePokerHand(hand1);
    const eval2 = evaluatePokerHand(hand2);

    if (eval1.rank !== eval2.rank) {
      return eval1.rank > eval2.rank ? 1 : -1;
    }

    // 散牌對散牌直接判定為平手，不比點數
    if (eval1.rank === 0 && eval2.rank === 0) {
      return 0;
    }

    // 其他同級牌型比較點數
    for (let i = 0; i < Math.max(eval1.values.length, eval2.values.length); i++) {
      const v1 = eval1.values[i] || 0;
      const v2 = eval2.values[i] || 0;
      if (v1 !== v2) return v1 > v2 ? 1 : -1;
    }

    return 0;
  };

  const simulatePokerShowdown = async (match: Match) => {
    const deck = createDeck();
    updateMC(`最終關：五張撲克對決！看誰的牌型最強！`);

    // 發牌給雙方
    const h1: Card[] = [];
    const h2: Card[] = [];

    await updateAndSyncMatchView(prev => ({
      ...prev,
      p1Hand: [],
      p2Hand: [],
      p1Score: 0,
      p2Score: 0,
      status: 'ACTION',
      roundMessage: '發牌中...'
    }));

    // 逐張發牌動畫
    for (let i = 0; i < 5; i++) {
      h1.push(deck.pop()!);
      await updateAndSyncMatchView(prev => ({ ...prev, p1Hand: [...h1] }));
      await new Promise(r => setTimeout(r, 400));

      h2.push(deck.pop()!);
      await updateAndSyncMatchView(prev => ({ ...prev, p2Hand: [...h2] }));
      await new Promise(r => setTimeout(r, 400));
    }

    await new Promise(r => setTimeout(r, 1000));

    // 評估牌型
    const eval1 = evaluatePokerHand(h1);
    const eval2 = evaluatePokerHand(h2);
    const result = compareHands(h1, h2);

    // 顯示雙方牌型，等待 5 秒讓玩家確認
    await updateAndSyncMatchView(prev => ({
      ...prev,
      roundMessage: `${match.p1.name}【${eval1.name}】 vs ${match.p2!.name}【${eval2.name}】`
    }));

    updateMC(`${match.p1.name}【${eval1.name}】vs ${match.p2!.name}【${eval2.name}】，請確認牌型...`);

    await new Promise(r => setTimeout(r, 5000));

    // 平手時重新發牌比賽
    if (result === 0) {
      await updateAndSyncMatchView(prev => ({
        ...prev,
        status: 'RESULT',
        roundMessage: `平手！${eval1.name} vs ${eval2.name}，重新比賽！`,
        p1Score: eval1.rank,
        p2Score: eval2.rank
      }));
      updateMC(`${match.p1.name}【${eval1.name}】vs ${match.p2!.name}【${eval2.name}】，平手！重新發牌！`);
      setTimeout(() => simulatePokerShowdown(match), 3000);
      return;
    }

    const winner = result > 0 ? match.p1 : match.p2!;

    await updateAndSyncMatchView(prev => ({
      ...prev,
      status: 'RESULT',
      roundMessage: `🎉 ${winner.name} 獲勝！🎉`,
      p1Score: eval1.rank,
      p2Score: eval2.rank
    }));

    updateMC(`恭喜 ${winner.name} 晉級！`);
    setTimeout(() => finalizeMatch(winner), 4000);
  };

  const finalizeMatch = (winner: Participant) => {
    setGameState(prev => {
      const nextIdx = prev.currentMatchIndex + 1;
      const isRoundOver = nextIdx >= prev.matches.length;
      const newWinners = [...prev.winnersOfRound, winner];

      if (isRoundOver && newWinners.length === 1) {
        return { ...prev, winnersOfRound: newWinners, currentMatchIndex: nextIdx, isSimulating: false, stage: GameStage.WINNER, finalWinner: newWinners[0] };
      }
      return { ...prev, winnersOfRound: newWinners, currentMatchIndex: nextIdx, isSimulating: false, stage: isRoundOver ? GameStage.ROUND_PREPARING : prev.stage };
    });
  };

  const renderCard = (card: Card, index: number) => (
    <div key={index} className="animate-scale-up inline-block mx-0.5 sm:mx-1">
      <div className={`w-8 h-12 sm:w-12 sm:h-16 md:w-20 md:h-28 rounded-md sm:rounded-lg bg-white border sm:border-2 flex flex-col items-center justify-between p-0.5 sm:p-1 md:p-2 shadow-lg ${['♥', '♦'].includes(card.suit) ? 'text-red-600 border-red-100' : 'text-black border-gray-100'}`}>
        <div className="w-full text-left font-bold text-[8px] sm:text-xs md:text-lg leading-none">{card.value}</div>
        <div className="text-lg sm:text-2xl md:text-5xl">{card.suit}</div>
        <div className="w-full text-right font-bold text-[8px] sm:text-xs md:text-lg leading-none rotate-180">{card.value}</div>
      </div>
    </div>
  );

  // 骰子點數對應的 Unicode 符號
  const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  const renderDice = (dice: number[]) => (
    <div className="flex gap-1 sm:gap-2 flex-wrap justify-center">
      {(dice || []).map((d, i) => (
        <div key={i} className="animate-scale-up w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 bg-white rounded-lg sm:rounded-xl flex items-center justify-center shadow-lg border-2 border-red-200">
          <span className="text-2xl sm:text-4xl md:text-5xl text-red-600">{DICE_FACES[d] || '?'}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen festive-bg text-white flex flex-col items-center p-2 sm:p-4 md:p-8 overflow-x-hidden">
      <header className="text-center mb-2 sm:mb-4 md:mb-8 w-full z-10">
        <h1 className="text-2xl sm:text-4xl md:text-8xl font-black gold-text drop-shadow-2xl mb-1 italic tracking-tighter">尾牙抽獎大對決</h1>
        <p className="text-yellow-200 tracking-[0.1em] sm:tracking-[0.3em] font-bold text-xs sm:text-sm md:text-base opacity-80">CHAMPIONSHIP GALA 2025</p>
      </header>

      <main className="w-full max-w-6xl flex-1 flex flex-col z-10">
        {/* 房間選擇畫面 */}
        {roomMode === 'selecting' && (
          <div className="flex flex-col items-center justify-center animate-fade-in py-12">
            <div className="w-full max-w-lg bg-black/40 backdrop-blur-xl p-8 rounded-[3rem] border-2 border-yellow-500/30 shadow-2xl">
              <h2 className="text-3xl font-black mb-8 text-yellow-500 text-center">選擇模式</h2>

              <div className="space-y-6">
                <button
                  onClick={handleCreateRoom}
                  className="w-full py-6 bg-gradient-to-r from-red-600 to-red-800 rounded-3xl font-black text-2xl shadow-2xl border-b-8 border-red-900 hover:translate-y-1 hover:border-b-4 transition-all"
                >
                  建立房間 (主持人)
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/20"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-black/40 px-4 text-white/60 text-sm">或</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <input
                    type="text"
                    value={joinRoomInput}
                    onChange={(e) => setJoinRoomInput(e.target.value.toUpperCase())}
                    placeholder="輸入房間代碼"
                    maxLength={6}
                    className="w-full bg-white/10 border-2 border-white/20 rounded-2xl px-6 py-4 text-2xl text-center tracking-[0.5em] outline-none focus:border-yellow-500 transition-all uppercase"
                  />
                  <button
                    onClick={handleJoinRoom}
                    disabled={joinRoomInput.length !== 6}
                    className="w-full py-5 bg-gradient-to-r from-blue-600 to-blue-800 disabled:from-gray-700 disabled:to-gray-700 rounded-3xl font-black text-xl shadow-2xl border-b-8 border-blue-900 disabled:border-gray-800 hover:translate-y-1 hover:border-b-4 transition-all"
                  >
                    加入房間 (觀眾)
                  </button>
                </div>

                {roomError && (
                  <div className="text-red-400 text-center font-bold bg-red-900/30 rounded-xl p-3">
                    {roomError}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 主持人斷線提示 (觀眾端) */}
        {hostDisconnected && roomMode === 'viewer' && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-black/90 p-8 rounded-3xl border-2 border-red-500 text-center">
              <div className="text-6xl mb-4">😢</div>
              <h3 className="text-2xl font-black text-red-500 mb-4">主持人已離線</h3>
              <button
                onClick={handleLeaveRoom}
                className="px-8 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold transition-all"
              >
                返回首頁
              </button>
            </div>
          </div>
        )}

        {/* 房間資訊顯示 */}
        {roomMode !== 'selecting' && (
          <div className="flex justify-between items-center mb-4 bg-black/30 rounded-2xl px-6 py-3">
            <div className="flex items-center gap-4">
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${roomMode === 'host' ? 'bg-red-600' : 'bg-blue-600'}`}>
                {roomMode === 'host' ? '主持人' : '觀眾'}
              </span>
              <span className="text-yellow-400 font-mono text-xl tracking-widest">
                房間: {roomId}
              </span>
            </div>
            <button
              onClick={handleLeaveRoom}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-bold transition-all"
            >
              離開房間
            </button>
          </div>
        )}

        {roomMode !== 'selecting' && gameState.stage === GameStage.SETUP && (
          <div className="flex flex-col items-center justify-center animate-fade-in py-12">
            <div className="w-full max-w-2xl bg-black/40 backdrop-blur-xl p-8 rounded-[3rem] border-2 border-yellow-500/30 shadow-2xl">
              <h2 className="text-3xl font-black mb-6 text-yellow-500 text-center">報名名單 🧧</h2>
              {/* 主持人可以新增參賽者 */}
              {roomMode === 'host' && (
                <div className="flex gap-2 mb-8">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addParticipant()}
                    placeholder="輸入參賽者姓名"
                    className="flex-1 bg-white/10 border-2 border-white/20 rounded-2xl px-6 py-3 text-xl outline-none focus:border-yellow-500 transition-all"
                  />
                  <button onClick={addParticipant} className="px-8 bg-yellow-500 text-red-900 font-black rounded-2xl hover:bg-yellow-400 transition-all shadow-lg">加入</button>
                </div>
              )}
              {/* 觀眾提示 */}
              {roomMode === 'viewer' && (
                <div className="text-center text-white/60 mb-8 p-4 bg-white/5 rounded-xl">
                  等待主持人新增參賽者並開始遊戲...
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                {gameState.allParticipants.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10 group">
                    <span className="truncate font-bold">{p.name}</span>
                    {/* 只有主持人可以刪除 */}
                    {roomMode === 'host' && (
                      <button onClick={() => setGameState(prev => ({...prev, allParticipants: prev.allParticipants.filter(x => x.id !== p.id)}))} className="text-red-500 font-black">×</button>
                    )}
                  </div>
                ))}
              </div>
              {/* 只有主持人可以開始遊戲 */}
              {roomMode === 'host' && (
                <button
                  onClick={startTournament}
                  disabled={gameState.allParticipants.length < 2}
                  className="w-full py-6 bg-gradient-to-r from-red-600 to-red-800 disabled:from-gray-700 rounded-3xl font-black text-3xl shadow-2xl border-b-8 border-red-900 hover:translate-y-1 hover:border-b-4 transition-all"
                >
                  開始冒險！ ⚔️
                </button>
              )}
            </div>
          </div>
        )}

        {(gameState.stage === GameStage.ROUND_PREPARING || gameState.stage === GameStage.SIMULATING_MATCHES) && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 h-full flex-1">
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-black/40 p-6 rounded-3xl border border-white/10 backdrop-blur-md">
                <div className="text-center mb-4 border-b border-white/10 pb-4">
                  <div className="text-yellow-500 font-black text-xs uppercase tracking-widest">第 {gameState.roundNumber} 關</div>
                  <div className="text-xl font-black gold-text">
                    {gameState.roundNumber === 1 ? "十八啦" : gameState.roundNumber === 2 ? "十點半" : "撲克對決"}
                  </div>
                </div>
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                  {gameState.matches.map((m, i) => {
                    const isCurrentMatch = i === gameState.currentMatchIndex;
                    const isCompleted = i < gameState.currentMatchIndex;
                    const winner = isCompleted ? gameState.winnersOfRound[i] : null;
                    const p1IsWinner = winner?.id === m.p1.id;
                    const p2IsWinner = winner?.id === m.p2?.id;

                    return (
                      <div key={i} className={`p-3 rounded-xl border-2 transition-all ${isCurrentMatch ? 'bg-yellow-500 text-red-900 border-white font-black scale-105 shadow-lg' : isCompleted ? 'bg-white/10 border-white/20' : 'bg-white/5 border-white/5 opacity-50'}`}>
                        <div className="flex justify-between items-center gap-2 text-sm">
                          <span className={`truncate flex-1 flex items-center gap-1 ${p1IsWinner ? 'text-green-400 font-black' : ''}`}>
                            {p1IsWinner && <span className="inline-block w-5 h-5 rounded-full bg-green-500 text-white text-xs flex items-center justify-center flex-shrink-0">✓</span>}
                            {m.p1.name}
                          </span>
                          <span className="text-[10px] italic">VS</span>
                          <span className={`truncate flex-1 text-right flex items-center justify-end gap-1 ${p2IsWinner ? 'text-green-400 font-black' : ''}`}>
                            {m.p2 ? m.p2.name : "輪空"}
                            {p2IsWinner && <span className="inline-block w-5 h-5 rounded-full bg-green-500 text-white text-xs flex items-center justify-center flex-shrink-0">✓</span>}
                            {!m.p2 && <span className="inline-block w-5 h-5 rounded-full bg-green-500 text-white text-xs flex items-center justify-center flex-shrink-0">✓</span>}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 bg-black/50 rounded-xl sm:rounded-[3rem] border-2 sm:border-4 border-yellow-600/20 p-2 sm:p-4 md:p-6 flex flex-col items-center justify-center relative min-h-[300px] sm:min-h-[400px] md:min-h-[500px] shadow-2xl">
              {(gameState.isSimulating || matchView.status === 'P1_TURN' || matchView.status === 'P2_TURN') ? (
                <div className="w-full flex flex-col items-center justify-around h-full py-2 sm:py-4 md:py-8">
                  <div className="text-sm sm:text-xl md:text-3xl font-black text-yellow-400 mb-2 sm:mb-4 md:mb-8 animate-pulse bg-black/60 px-3 sm:px-6 md:px-8 py-1 sm:py-2 rounded-full border border-yellow-500/50 text-center max-w-full">
                    {matchView.roundMessage}
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-around w-full max-w-4xl gap-2 sm:gap-4">
                    {/* Player 1 */}
                    <div className="flex-1 flex flex-col items-center gap-2 sm:gap-3 w-full sm:w-auto">
                      <div className="flex flex-row sm:flex-col items-center gap-2 sm:gap-3">
                        <div className="w-16 h-16 sm:w-24 sm:h-24 md:w-36 md:h-36 rounded-full bg-red-600 flex items-center justify-center border-2 sm:border-4 border-yellow-500 shadow-xl overflow-hidden relative flex-shrink-0">
                           <span className="text-2xl sm:text-4xl md:text-6xl font-black">{gameState.matches[gameState.currentMatchIndex].p1.name[0]}</span>
                           <div className="absolute bottom-0 w-full bg-black/60 text-[8px] sm:text-[10px] py-0.5 sm:py-1 text-center font-bold">P1</div>
                        </div>
                        <div className="flex flex-col items-center">
                          <div className="text-sm sm:text-xl font-black">{gameState.matches[gameState.currentMatchIndex].p1.name}</div>
                          <div className="text-base sm:text-2xl font-black text-yellow-400">
                            {gameState.roundNumber === 1 && matchView.p1DiceResult ? matchView.p1DiceResult : ''}
                            {gameState.roundNumber === 2 && matchView.p1Score > 0 ? `${matchView.p1Score} 點` : ''}
                            {gameState.roundNumber === 3 && (matchView.p1Hand?.length === 5) ? HAND_NAMES[evaluatePokerHand(matchView.p1Hand).rank] : ''}
                          </div>
                        </div>
                      </div>
                      <div className="min-h-[50px] sm:min-h-[80px] md:min-h-[120px] flex items-center justify-center flex-wrap gap-0.5 sm:gap-1">
                        {gameState.roundNumber === 1 ? (
                          (matchView.p1Dice?.length > 0) ? renderDice(matchView.p1Dice) : <div className="text-3xl sm:text-6xl animate-bounce">🎲</div>
                        ) : (
                          (matchView.p1Hand || []).map((c, idx) => renderCard(c, idx))
                        )}
                      </div>
                      {/* P1 控制按鈕 - 只有主持人可以操作，6點以下必須補牌，5張牌過五關自動獲勝 */}
                      {roomMode === 'host' && gameState.roundNumber === 2 && matchView.status === 'P1_TURN' && matchView.p1Score <= 10.5 && (matchView.p1Hand?.length || 0) < 5 && (
                        <div className="flex gap-2 sm:gap-4 mt-1 sm:mt-2 relative z-10">
                          <button onClick={handleHit} className="px-4 sm:px-6 py-2 sm:py-3 bg-green-600 hover:bg-green-500 rounded-lg sm:rounded-xl font-black text-sm sm:text-lg transition-all shadow-lg">補牌</button>
                          {matchView.p1Score >= 6 && (
                            <button onClick={handlePass} className="px-4 sm:px-6 py-2 sm:py-3 bg-red-600 hover:bg-red-500 rounded-lg sm:rounded-xl font-black text-sm sm:text-lg transition-all shadow-lg">停牌</button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="text-2xl sm:text-5xl md:text-7xl font-black italic gold-text animate-pulse my-1 sm:my-0">VS</div>

                    {/* Player 2 */}
                    <div className="flex-1 flex flex-col items-center gap-2 sm:gap-3 w-full sm:w-auto">
                      <div className="flex flex-row sm:flex-col items-center gap-2 sm:gap-3">
                        <div className="w-16 h-16 sm:w-24 sm:h-24 md:w-36 md:h-36 rounded-full bg-blue-600 flex items-center justify-center border-2 sm:border-4 border-yellow-500 shadow-xl overflow-hidden relative flex-shrink-0">
                           <span className="text-2xl sm:text-4xl md:text-6xl font-black">{gameState.matches[gameState.currentMatchIndex].p2?.name[0]}</span>
                           <div className="absolute bottom-0 w-full bg-black/60 text-[8px] sm:text-[10px] py-0.5 sm:py-1 text-center font-bold">P2</div>
                        </div>
                        <div className="flex flex-col items-center">
                          <div className="text-sm sm:text-xl font-black">{gameState.matches[gameState.currentMatchIndex].p2?.name}</div>
                          <div className="text-base sm:text-2xl font-black text-yellow-400">
                            {gameState.roundNumber === 1 && matchView.p2DiceResult ? matchView.p2DiceResult : ''}
                            {gameState.roundNumber === 2 && matchView.p2Score > 0 ? `${matchView.p2Score} 點` : ''}
                            {gameState.roundNumber === 3 && (matchView.p2Hand?.length === 5) ? HAND_NAMES[evaluatePokerHand(matchView.p2Hand).rank] : ''}
                          </div>
                        </div>
                      </div>
                      <div className="min-h-[50px] sm:min-h-[80px] md:min-h-[120px] flex items-center justify-center flex-wrap gap-0.5 sm:gap-1">
                        {gameState.roundNumber === 1 ? (
                          (matchView.p2Dice?.length > 0) ? renderDice(matchView.p2Dice) : <div className="text-3xl sm:text-6xl animate-bounce">🎲</div>
                        ) : (
                          (matchView.p2Hand || []).map((c, idx) => renderCard(c, idx))
                        )}
                      </div>
                      {/* P2 控制按鈕 - 只有主持人可以操作，6點以下必須補牌，5張牌過五關自動獲勝 */}
                      {roomMode === 'host' && gameState.roundNumber === 2 && matchView.status === 'P2_TURN' && matchView.p2Score <= 10.5 && (matchView.p2Hand?.length || 0) < 5 && (
                        <div className="flex gap-2 sm:gap-4 mt-1 sm:mt-2 relative z-10">
                          <button onClick={handleHit} className="px-4 sm:px-6 py-2 sm:py-3 bg-green-600 hover:bg-green-500 rounded-lg sm:rounded-xl font-black text-sm sm:text-lg transition-all shadow-lg">補牌</button>
                          {matchView.p2Score >= 6 && (
                            <button onClick={handlePass} className="px-4 sm:px-6 py-2 sm:py-3 bg-red-600 hover:bg-red-500 rounded-lg sm:rounded-xl font-black text-sm sm:text-lg transition-all shadow-lg">停牌</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center animate-scale-up">
                  <div className="text-[10rem] opacity-10 absolute inset-0 flex items-center justify-center pointer-events-none">⚔️</div>
                  <h3 className="text-4xl font-black text-yellow-500 mb-6 drop-shadow-lg">
                    {gameState.currentMatchIndex >= gameState.matches.length ? "本輪結束！" : "準備對決！"}
                  </h3>
                  {gameState.currentMatchIndex < gameState.matches.length && (
                    <div className="mb-10 p-6 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-sm">
                      <p className="text-xl opacity-80 mb-2">當前對戰</p>
                      <p className="text-4xl font-black text-white">
                        {gameState.matches[gameState.currentMatchIndex].p1.name} <span className="text-yellow-500 text-2xl mx-4">VS</span> {gameState.matches[gameState.currentMatchIndex].p2?.name || "輪空"}
                      </p>
                    </div>
                  )}
                  {/* 只有主持人可以控制遊戲進行 */}
                  {roomMode === 'host' ? (
                    <button
                      onClick={gameState.currentMatchIndex >= gameState.matches.length ? () => prepareRound(gameState.winnersOfRound, gameState.roundNumber + 1) : playMatch}
                      className="group px-16 py-8 bg-gradient-to-b from-yellow-400 to-yellow-600 text-red-900 font-black text-3xl rounded-full shadow-2xl hover:scale-105 active:scale-95 transition-all border-4 border-yellow-200"
                    >
                      {gameState.currentMatchIndex >= gameState.matches.length ? "進入下一關 ➔" : "開戰！ FIGHT"}
                    </button>
                  ) : (
                    <div className="text-xl text-white/60 bg-white/5 px-8 py-4 rounded-2xl">
                      等待主持人操作...
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {gameState.stage === GameStage.WINNER && gameState.finalWinner && (
          <div className="flex-1 flex flex-col items-center justify-center animate-scale-up text-center relative py-12">
            <div className="absolute inset-0 bg-yellow-400/5 blur-[120px] rounded-full"></div>
            <div className="text-[12rem] mb-4 animate-bounce-subtle drop-shadow-2xl z-20">🏆</div>
            <h2 className="text-8xl md:text-[10rem] font-black gold-text mb-4 z-20 drop-shadow-2xl">{gameState.finalWinner.name}</h2>
            <p className="text-3xl tracking-[0.5em] text-yellow-400 font-bold mb-12 z-20 uppercase">The Ultimate Champion</p>
            
            <div className="bg-black/40 backdrop-blur-2xl p-12 rounded-[4rem] border-4 border-yellow-500/50 max-w-xl w-full shadow-2xl z-20">
               <p className="text-4xl font-bold mb-8">恭喜獲得最後大獎！</p>
               {roomMode === 'host' && (
                 <button onClick={() => setGameState(prev => ({...prev, stage: GameStage.SETUP, finalWinner: null, allParticipants: defaultParticipants, winnersOfRound: [], matches: [], currentMatchIndex: 0, roundNumber: 0}))} className="px-12 py-5 bg-white/10 hover:bg-white/20 rounded-2xl font-bold text-xl transition-all border border-white/20">重新開始遊戲</button>
               )}
            </div>
          </div>
        )}
      </main>

      <MCPanel commentary={gameState.mcCommentary} />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(234,179,8,0.5); border-radius: 10px; }
        @keyframes bounce-subtle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .animate-bounce-subtle { animation: bounce-subtle 3s infinite ease-in-out; }
        @keyframes scaleUp { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-scale-up { animation: scaleUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fadeIn 0.6s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default App;
