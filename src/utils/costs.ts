/**
 * Utilities for calculating API costs
 */

import { TokenUsage, CostEstimate, ModelPricing } from '../types.js';

/**
 * Calculate estimated cost for an API call based on token usage
 */
export function calculateCost(model: string, usage?: TokenUsage): CostEstimate {
  if (!usage || !usage.input_tokens || !usage.output_tokens) {
    return { 
      inputCost: 'unknown', 
      outputCost: 'unknown', 
      totalCost: 'unknown',
      disclaimer: 'No token usage data available'
    };
  }
  
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  
  // Pricing per 1M tokens (as of March 2024)
  // These are approximate and may change
  const pricing: ModelPricing = {
    // Claude 3 models
    'claude-3-opus': { input: 15.00, output: 75.00 },
    'claude-3-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },
    // Claude 3.5 models
    'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-5-haiku': { input: 0.25, output: 1.25 },
    // Claude 3.7 models
    'claude-3-7-sonnet': { input: 5.00, output: 25.00 }
  };
  
  // Find the matching price model (handle "latest" variants)
  let price = { input: 3.00, output: 15.00 }; // Default to Sonnet pricing
  
  for (const [priceModel, priceData] of Object.entries(pricing)) {
    if (model.includes(priceModel)) {
      price = priceData;
      break;
    }
  }
  
  // Calculate costs in USD
  const inputCost = (inputTokens / 1000000) * price.input;
  const outputCost = (outputTokens / 1000000) * price.output;
  const totalCost = inputCost + outputCost;
  
  return {
    model,
    inputTokens,
    outputTokens,
    inputCost: inputCost.toFixed(6),
    outputCost: outputCost.toFixed(6),
    totalCost: totalCost.toFixed(6),
    disclaimer: 'Cost is approximate and based on public pricing'
  };
}