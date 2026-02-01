import { GoogleGenAI } from "@google/genai";

export const getMCCommentary = async (context: string): Promise<string> => {
  try {
    // Fix: Create a new GoogleGenAI instance right before making an API call to ensure it always uses the most up-to-date API key
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `你是一位充滿活力、幽默感十足的尾牙主持人。
      請針對以下情境生成一段簡短（30字以內）、激勵人心且富有節慶氣氛的對話。
      情境：${context}`,
      config: {
        temperature: 0.8,
      }
    });
    return response.text || "讓我們繼續精彩的比賽！";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "好運即將降臨，大家加油！";
  }
};