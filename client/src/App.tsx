import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './stores/authStore';
import { ChatLayout } from './components/layout/ChatLayout';
import { LoginPage } from './pages/LoginPage';
import { LoadingSpinner } from './components/ui/LoadingSpinner';

function App() {
  const { user, isLoading, initializeAuth } = useAuthStore();

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="App">
      <Router>
        <Routes>
          <Route 
            path="/login" 
            element={user ? <Navigate to="/" /> : <LoginPage />} 
          />
          <Route 
            path="/" 
            element={user ? <ChatLayout /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/room/:roomId" 
            element={user ? <ChatLayout /> : <Navigate to="/login" />} 
          />
        </Routes>
      </Router>
      
      <Toaster 
        position="top-right"
        toastOptions={{
          style: {
            background: '#1f2937',
            color: '#f9fafb',
            border: '1px solid #374151',
          },
        }}
      />
    </div>
  );
}

export default App;