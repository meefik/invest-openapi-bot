const nconf = require('nconf');
const express = require('express');
const bodyParser = require('body-parser');
// https://github.com/TinkoffCreditSystems/invest-openapi-js-sdk
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
  volatility: 0.01,
  profit: 0.05,
  quantity: 1,
  limit: 10,
  token: null
});

const api = new OpenAPI({
  // apiURL: 'http://localhost:8080',
  // socketURL: 'ws://localhost:8080',
  // apiURL: 'https://api-invest.tinkoff.ru/openapi/sandbox',
  apiURL: 'https://api-invest.tinkoff.ru/openapi',
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
    console.log(candle.time, candle.figi, candle.c, candle.v);
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
    // данные последней свечи
    const bar = candles[candles.length - 1];
    // цена закрытия
    const price = bar.c;
    // получить данные по инструменту
    const { 
      lots = 0,
      averagePositionPrice = {}
    } = await api.instrumentPortfolio({ figi }) || {};
    // есть сигнал на покупку
    if (bar.signal === 'Buy') {
      // получить список недавних операций
      const {
        operations = []
      } = await api.operations({
        figi,
        from: new Date(now - nconf.get('offset') * intervalInMS).toJSON(),
        to: new Date(now + intervalInMS).toJSON()
      }) || [];
      // цена последней операции по инструменту
      const lastOperationPrice = (operations[0] || {}).price;
      const volatility = lastOperationPrice ? Math.abs(price/lastOperationPrice-1) : Infinity;
      // если нет открытых позиций по инструменту
      if (!lots) {
        try {
          const order = await api.marketOrder({ figi, lots: nconf.get('quantity'), operation: 'Buy' });
          console.log(new Date(now).toJSON(), order.orderId, bar.figi, bar.signal, price, lots, order.executedLots);
        } catch(err) {
          console.log(err.message);
        }
      }
      // если открытые позиции есть и средняя цена позиции больше текущей (+волатильность)
      else if (lots > 0 && lots < nconf.get('limit') && volatility > nconf.get('volatility')) {
        try {
          const order = await api.marketOrder({ figi, lots: nconf.get('quantity'), operation: 'Buy' });
          console.log(new Date(now).toJSON(), order.orderId, bar.figi, bar.signal, price, lots, order.executedLots);
        } catch(err) {
          console.log(err.message);
        }
      }
    }
    // есть сигнал на продажу и куплены лоты
    else if (bar.signal === 'Sell' && lots > 0) {
      const orders = (await api.orders() || []).filter(item => item.figi === figi);
      const profit = price/averagePositionPrice.value-1;
      // нет отложенных ордеров по данному инструменту и текущая цена (-волатильность) выше средней цены позиции
      if (!orders.length && profit > nconf.get('profit')) {
        try {
          const order = await api.marketOrder({ figi, lots, operation: 'Sell' });
          console.log(new Date(now).toJSON(), order.orderId, bar.figi, bar.signal, price, lots, order.executedLots);
        } catch(err) {
          console.log(err.message);
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
  const {
    lots,
    expectedYield = {},
    averagePositionPrice = {}
  } = await api.instrumentPortfolio({ figi }) || {};
  res.json({
    lots,
    price: candles[candles.length-1].c,
    averagePositionPrice: averagePositionPrice.value,
    expectedYield: expectedYield.value,
    candles
  });
});
app.listen(nconf.get('port'), nconf.get('host'));
