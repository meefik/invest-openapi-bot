const nconf = require('nconf');
const express = require('express');
const bodyParser = require('body-parser');
const OpenAPI = require('@tinkoff/invest-openapi-js-sdk/build/OpenAPI.cjs');

nconf.env({
  separator: '_',
  lowerCase: true,
  parseValues: true
});
nconf.defaults({
  host: '0.0.0.0',
  port: 5000,
  ticker: 'MSFT',
  fastema: 3,
  slowema: 5,
  interval: 'hour',
  offset: 7 * 24,
  multiplier: 0.1,
  volatility: 0.01,
  volume: 10,
  token: null
});

const api = new OpenAPI({
  // apiURL: 'http://localhost:8080',
  // socketURL: 'ws://localhost:8080',
  apiURL: 'https://api-invest.tinkoff.ru/openapi/sandbox',
  socketURL: 'wss://api-invest.tinkoff.ru/openapi/md/v1/md-openapi/ws',
  secretToken: nconf.get('token')
});

function calcEMA(n, price, prev) {
  if (typeof prev === 'undefined') prev = price;
  const alpha = 2 / (n + 1);
  return (alpha * price + (1 - alpha) * prev);
}

function parseInterval(interval) {
  switch (interval) {
  case '1min':
    return 60 * 1000;
  case '2min':
    return 2 * 60 * 1000;
  case '3min':
    return 3 * 60 * 1000;
  case '5min':
    return 5 * 60 * 1000;
  case '10min':
    return 10 * 60 * 1000;
  case '15min':
    return 15 * 60 * 1000;
  case '30min':
    return 30 * 60 * 1000;
  case 'hour':
    return 60 * 60 * 1000;
  case 'day':
    return 24 * 60 * 60 * 1000;
  case 'week':
    return 7 * 24 * 60 * 60 * 1000;
  case 'month':
    return 31 * 24 * 60 * 60 * 1000;
  }
}

async function run() {
  const interval = nconf.get('interval');
  const { figi } = await api.searchOne({ ticker: nconf.get('ticker') });
  let time;
  api.candle({ figi, interval }, async function(candle) {
    if (candle.time === time) return;
    time = candle.time;
    console.log('Candle', candle);
    const now = new Date(candle.time).getTime();
    const intervalInMS = parseInterval(interval);
    // получить список свечей за указанный промежуток времени
    const { candles } = await api.candlesGet({ 
      figi,
      interval, 
      from: new Date(now - nconf.get('offset') * intervalInMS).toJSON(),
      to: new Date(now).toJSON()
    });
    // вычислить EMA и точки пересечения
    let fastEMA, slowEMA;
    for (let i = 0; i < candles.length; i++) {
      const bar = candles[i];
      bar.time = new Date(bar.time).getTime();
      const price = (bar.h+bar.l+bar.o+bar.c)/4;
      bar.fastEMA = calcEMA(nconf.get('fastema'), price, fastEMA);
      bar.slowEMA = calcEMA(nconf.get('slowema'), price, slowEMA);
      if (slowEMA > fastEMA && bar.slowEMA < bar.fastEMA) {
        bar.signal = 'Buy';
      }
      if (slowEMA < fastEMA && bar.slowEMA > bar.fastEMA) {
        bar.signal = 'Sell';
      }
      fastEMA = bar.fastEMA;
      slowEMA = bar.slowEMA;
    }
    if (candles.length < 1) return;
    // получить данные предыдущей свечи
    const bar = candles[candles.length - 1];
    // получить данные по инструменту
    const { 
      lots = 0,
      averagePositionPrice = {}
    } = await api.instrumentPortfolio({ figi }) || {};
    // получить список недавних операций
    const {
      operations = []
    } = await api.operations({
      figi,
      from: new Date(now - nconf.get('offset') * intervalInMS).toJSON(),
      to: new Date(now + intervalInMS).toJSON()
    }) || [];
    // цена последней операции по инструменту
    const { price = Infinity } = operations[0] || {};
    // есть сигнал на покупку
    if (bar.signal === 'Buy') {
      console.log(bar.signal, lots, averagePositionPrice.value, bar.c, price);
      // если нет открытых позиций по инструменту
      if (!lots) {
        try {
          const order = await api.marketOrder({
            figi,
            lots: nconf.get('volume'),
            operation: 'Buy'
          });
          console.log('Buy', order);
        } catch(err) {
          console.log(err);
        }
      }
      // если открытые позиции есть и средняя цена позиции больше текущей (+волатильность)
      else if (lots > 0 && price > bar.c+nconf.get('volatility')) {
        try {
          const order = await api.marketOrder({
            figi,
            lots: nconf.get('volume') + lots * nconf.get('multiplier'),
            operation: 'Buy'
          });
          console.log('Add', order);
        } catch(err) {
          console.log(err);
        }
      }
    }
    // есть сигнал на продажу и куплены лоты
    else if (bar.signal === 'Sell' && lots > 0) {
      console.log(bar.signal, lots, averagePositionPrice.value, bar.c, price);
      const orders = (await api.orders() || []).filter(item => item.figi === figi);
      // нет отложенных ордеров по данному инструменту и текущая цена (-волатильность) выше средней цены позиции
      if (!orders.length && averagePositionPrice.value < bar.c-nconf.get('volatility')) {
        try {
          const order = await api.marketOrder({ figi, lots, operation: 'Sell' });
          console.log('Sell', order);
        } catch(err) {
          console.log(err);
        }
      }
    }
  });
  return figi;
}

run();

const app = express();
app.enable('trust proxy');
app.disable('x-powered-by');
app.use(bodyParser.json());
app.use(express.static('public'));
app.get('/api/candles', async function (req, res) {
  const now = new Date();
  const interval = nconf.get('interval');
  const intervalInMS = parseInterval(interval);
  const { figi } = await api.searchOne({ ticker: nconf.get('ticker') });
  const { candles } = await api.candlesGet({ 
    figi,
    interval, 
    from: new Date(now - nconf.get('offset') * intervalInMS).toJSON(),
    to: new Date(now).toJSON()
  });
  // вычислить EMA и точки пересечения
  let fastEMA, slowEMA;
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    bar.time = new Date(bar.time).getTime();
    const price = (bar.h+bar.l+bar.o+bar.c)/4;
    bar.fastEMA = calcEMA(nconf.get('fastema'), price, fastEMA);
    bar.slowEMA = calcEMA(nconf.get('slowema'), price, slowEMA);
    if (slowEMA > fastEMA && bar.slowEMA < bar.fastEMA) {
      bar.signal = 'Buy';
    }
    if (slowEMA < fastEMA && bar.slowEMA > bar.fastEMA) {
      bar.signal = 'Sell';
    }
    fastEMA = bar.fastEMA;
    slowEMA = bar.slowEMA;
  }
  res.json(candles);
});
app.get('/api/portfolio', async function (req, res) {
  const { figi } = await api.searchOne({ ticker: nconf.get('ticker') });
  const portfolio = await api.instrumentPortfolio({ figi });
  res.json(portfolio);
});
app.listen(nconf.get('port'), nconf.get('host'));
