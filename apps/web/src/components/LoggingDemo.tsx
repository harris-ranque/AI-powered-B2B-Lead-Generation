/**
 * Demo component to showcase the logging utility functionality
 */

import React, { useEffect, useState } from 'react';
import { useLogger, timeOperation, trackError } from '../utils/logger';

export const LoggingDemo: React.FC = () => {
  const logger = useLogger('LoggingDemo');
  const [counter, setCounter] = useState(0);

  useEffect(() => {
    logger.componentMount('LoggingDemo');
    
    // Simulate some initialization
    logger.info('Component initialized', {
      initialCounter: counter,
      timestamp: new Date().toISOString()
    });

    return () => {
      logger.componentUnmount('LoggingDemo');
    };
  }, [counter, logger]);

  const handleApiCall = async () => {
    logger.userAction('API call button clicked');
    
    const result = await timeOperation('Mock API Call', async () => {
      logger.apiRequest('/api/mock', 'POST', { counter });
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
      
      const response = { 
        success: true, 
        data: `API called ${counter + 1} times`,
        timestamp: new Date().toISOString()
      };
      
      logger.apiResponse('/api/mock', 200, response, 500);
      return response;
    });

    setCounter(prev => prev + 1);
    logger.debug('Counter updated', { newValue: counter + 1 });
  };

  const handleError = () => {
    logger.userAction('Error button clicked');
    
    try {
      throw new Error('This is a test error for logging demonstration');
    } catch (error) {
      trackError(error as Error, {
        component: 'LoggingDemo',
        action: 'handleError',
        counter: counter
      });
    }
  };

  const handlePerformanceTest = () => {
    logger.userAction('Performance test started');
    
    // Simulate some heavy computation
    const startTime = performance.now();
    
    // Mock heavy operation
    let result = 0;
    for (let i = 0; i < 1000000; i++) {
      result += Math.random();
    }
    
    const duration = performance.now() - startTime;
    logger.performance('Heavy computation', duration, {
      iterations: 1000000,
      result: result.toFixed(2)
    });
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md">
      <h2 className="text-2xl font-bold mb-4">Logging Demo</h2>
      <p className="mb-4 text-gray-600">
        Check the browser console to see logging output. 
        In development mode, you'll see detailed, colored logs.
      </p>
      
      <div className="space-y-3">
        <div>
          <p className="text-sm text-gray-500 mb-1">API calls made: {counter}</p>
          <button
            onClick={handleApiCall}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded transition-colors"
          >
            Make API Call (Check Console)
          </button>
        </div>
        
        <button
          onClick={handleError}
          className="w-full bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-4 rounded transition-colors"
        >
          Trigger Error (Check Console)
        </button>
        
        <button
          onClick={handlePerformanceTest}
          className="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-4 rounded transition-colors"
        >
          Performance Test (Check Console)
        </button>
      </div>
      
      <div className="mt-4 p-3 bg-gray-100 rounded text-xs">
        <p><strong>Development mode:</strong> Detailed, colored logs with context</p>
        <p><strong>Production mode:</strong> Minimal, structured logs</p>
        <p><strong>Current mode:</strong> {import.meta.env.MODE}</p>
      </div>
    </div>
  );
};

export default LoggingDemo;