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
  ticker: 'TRUR',
  fastema: 3,
  slowema: 5,
  interval: 'hour',
  offset: 7 * 24,
  multiplier: 0.1,
  volume: 1000,
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
  api.candle({ figi, interval, from: new Date().toJSON() }, async function(candle) {
    if (candle.time === time) return;
    time = candle.time;
    const now = new Date(candle.time);
    const intervalInMS = parseInterval(interval);
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
    // получить данные предыдущей свечи
    const bar = candles[candles.length - 2];
    const price = bar.c;
    // получить данные по инструменту
    const { 
      lots = 0,
      averagePositionPrice = { value: Infinity }
    } = await api.instrumentPortfolio({ figi }) || {};
    // есть сигнал на покупку
    if (bar.signal === 'Buy') {
      console.log(bar.signal, lots, averagePositionPrice.value, price);
      // текущая цена ниже средней цены позиции
      if (averagePositionPrice.value > price) {
        const volume = lots > 0 ? lots + lots * nconf.get('multiplier') : nconf.get('volume');
        const order = await api.marketOrder({ figi, lots: volume, operation: 'Buy' });
        console.log('Buy', order);
      }
    }
    // есть сигнал на продажу и куплены лоты
    else if (bar.signal === 'Sell' && lots > 0) {
      console.log(bar.signal, lots, averagePositionPrice.value, price);
      const orders = (await api.orders() || []).filter(item => item.figi === figi);
      // нет отложенных ордеров по данному инструменту и текущая цена выше средней цены позиции
      if (!orders.length && averagePositionPrice.value < price) {
        const order = await api.marketOrder({ figi, lots, operation: 'Sell' });
        console.log('Sell', order);
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
