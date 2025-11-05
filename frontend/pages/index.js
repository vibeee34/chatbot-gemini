'use client'; 

import { useState, useRef, useEffect } from 'react';
import { FileUp, Send, Loader2, MessageSquare } from 'lucide-react'; 

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:5001"; 

const App = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [indexedFileName, setIndexedFileName] = useState(null);
  const [isIndexed, setIsIndexed] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  
  const fileInputRef = useRef(null);
  const chatContainerRef = useRef(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleUploadDocument = async (fileToUpload) => {
    setIsIndexing(true);
    setIsIndexed(false);
    setMessages([]); 

    try {
      const formData = new FormData();
      formData.append('file', fileToUpload);
      const response = await fetch(`${BACKEND_URL}/upload-document`, { method: 'POST', body: formData });
      
      if (!response.ok) throw new Error(`Server status ${response.status}`);
      const result = await response.json();
      
      setIsIndexed(true);
      setIndexedFileName(result.sourceFile || 'file');
      
    } catch (error) {
      setMessages(prev => [...prev, { 
          id: Date.now(), 
          text: `Indexing failed: ${error.message}`, 
          sender: 'gemini' 
      }]);
      setIsIndexed(false);
    } finally {
      setIsIndexing(false);
    }
  }

  const handleFileSelect = (event) => {
    if (event.target.files?.[0]) {
      handleUploadDocument(event.target.files[0]); 
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return; 

    const userMessage = input.trim();
    setMessages((prev) => [...prev, { id: Date.now(), text: userMessage, sender: 'user' }]);
    setInput('');
    setIsLoading(true);

    try {
        const response = await fetch(`${BACKEND_URL}/query-rag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: userMessage }),
        });

        if (!response.ok) throw new Error(`Query failed with status ${response.status}.`);
        const result = await response.json();
        
        setMessages((prev) => [
            ...prev,
            { 
                id: Date.now() + 1, 
                text: result.answer, 
                sender: 'gemini',
            },
        ]);
    } catch (error) {
        setMessages((prev) => [
            ...prev,
            { id: Date.now() + 1, text: `Query failed. Check server connection.`, sender: 'gemini' },
        ]);
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4 font-sans">
      <div className="w-full max-w-xl h-[80vh] flex flex-col bg-white border border-gray-400 rounded-xl overflow-hidden shadow-2xl">
        
        <header className="p-3 border-b border-gray-300 bg-gray-50 flex justify-between items-center rounded-t-xl">
            <div className="flex items-center">
                <MessageSquare className="w-5 h-5 mr-2 text-indigo-600" />
                <h1 className="text-lg font-bold text-gray-800">Microbot</h1>
            </div>
            {isIndexing ? (
                <span className="flex items-center text-sm text-yellow-600 bg-yellow-100 px-2 py-1 rounded-full font-medium">
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Uploading...
                </span>
            ) : isIndexed ? (
                <span className="flex items-center text-sm text-green-600 bg-green-100 px-2 py-1 rounded-full font-medium">
                    Uploaded!
                </span>
            ) : (
                <span className="flex items-center text-sm text-gray-500 px-2 py-1"></span> 
            )}
        </header>

        <div 
          ref={chatContainerRef} 
          className="flex-1 overflow-y-auto p-4 space-y-4 bg-white"
        >
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[80%] p-3 rounded-xl shadow-md text-sm ${
                  msg.sender === 'user' 
                    ? 'bg-indigo-500 text-white rounded-br-none' 
                    : 'bg-gray-100 text-gray-800 rounded-tl-none border border-gray-200'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.text}</div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="p-3 rounded-xl bg-gray-100 flex items-center text-sm text-gray-700 shadow-md">
                <Loader2 className="w-4 h-4 mr-2 animate-spin text-blue-500" />
                Typing...
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-300 bg-gray-50 rounded-b-xl">
          <form onSubmit={handleSendMessage} className="flex space-x-3">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".pdf"
                className="hidden"
                disabled={isIndexing}
            />
            
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`p-3 rounded-xl flex-shrink-0 transition-colors shadow-lg ${
                isIndexing 
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-white text-indigo-600 hover:bg-indigo-50 border border-indigo-400'
              }`}
              disabled={isIndexing}
            >
              <FileUp className="w-5 h-5" />
            </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={isLoading}
            />
            
            <button
              type="submit"
              className={`p-3 rounded-xl flex-shrink-0 transition-colors shadow-lg ${
                input.trim() && !isLoading 
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
                  : 'bg-gray-400 text-gray-200 cursor-not-allowed'
              }`}
              disabled={!input.trim() || isLoading}
              title="Send Message"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default App;
