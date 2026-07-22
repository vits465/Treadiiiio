const axios = require('axios');

async function train() {
  const pairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD'];
  for (const pair of pairs) {
    try {
      console.log(`Triggering train for ${pair}...`);
      const response = await axios.post('http://127.0.0.1:8000/train', {
        instrument: pair,
        granularity: "1h",
        lookback_days: 365,
        model_type: "xgboost",
        allow_synthetic: true
      }, {
        headers: {
          'X-API-Key': 'a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8'
        }
      });
      console.log(`Success for ${pair}:`, response.data.model_id);
    } catch (e) {
      console.error(`Error for ${pair}:`, e.message);
    }
  }
}

train();
