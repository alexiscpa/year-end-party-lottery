
import React from 'react';

interface MCPanelProps {
  commentary: string;
}

const MCPanel: React.FC<MCPanelProps> = ({ commentary }) => {
  return (
    <div className="fixed bottom-6 right-6 w-80 bg-white/90 backdrop-blur-md rounded-2xl p-4 shadow-2xl border-4 border-yellow-500 animate-bounce-subtle">
      <div className="flex items-start gap-3">
        <div className="bg-red-600 rounded-full p-2 text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
        </div>
        <div>
          <h4 className="font-bold text-red-700 text-sm">AI 主持人 小陳</h4>
          <p className="text-gray-800 italic text-sm mt-1 leading-relaxed">
            「{commentary}」
          </p>
        </div>
      </div>
    </div>
  );
};

export default MCPanel;
