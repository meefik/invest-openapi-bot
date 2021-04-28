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
  token: null,
  // apiurl: 'http://localhost:8080',
  // socketurl: 'ws://localhost:8080',
  // apiurl: 'https://api-invest.tinkoff.ru/openapi/sandbox',
  apiurl: 'https://api-invest.tinkoff.ru/openapi',
  socketurl: 'wss://api-invest.tinkoff.ru/openapi/md/v1/md-openapi/ws',
  fastema: 3,
  slowema: 5,
  profit: 0.1, // 10%
  movement: 0.5 // 1/2 volatility
});

function calcEMA(n, price, prev) {
  if (typeof prev === 'undefined') prev = price;
  const alpha = 2 / (n + 1);
  return (alpha * price + (1 - alpha) * prev);
}

async function run(time, figi) {
  const HOUR = 60 * 60 * 1000;
  const WEEK = 7 * 24 * HOUR;
  const YEAR = 365 * 24 * HOUR;
  // получить список свечей за указанный промежуток времени
  const { candles } = await api.candlesGet({
    figi,
    interval: 'hour',
    from: new Date(time - WEEK).toJSON(),
    to: new Date(time).toJSON()
  });
  // вычислить EMA и точки пересечения
  let fastEMA, slowEMA, trendEMA;
  let min = Infinity; let max = 0;
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    bar.time = new Date(bar.time).getTime();
    const price = (bar.h + bar.l + bar.o + bar.c) / 4;
    bar.fastEMA = calcEMA(nconf.get('fastema'), price, fastEMA);
    bar.slowEMA = calcEMA(nconf.get('slowema'), price, slowEMA);
    bar.trendEMA = calcEMA(candles.length, price, trendEMA);
    if (trendEMA > fastEMA && bar.trendEMA < bar.fastEMA) {
      bar.signal = 'Buy';
    }
    if (slowEMA < fastEMA && bar.slowEMA > bar.fastEMA) {
      bar.signal = 'Sell';
    }
    fastEMA = bar.fastEMA;
    slowEMA = bar.slowEMA;
    trendEMA = bar.trendEMA;
    if (bar.c > max) max = bar.c;
    if (bar.c < min) min = bar.c;
  }
  if (candles.length < 1) return;
  // данные последней свечи
  const bar = candles[candles.length - 1];
  console.log(new Date(bar.time).toJSON(), figi, bar.c, bar.v);
  // если нет сигнала, то ничего не делать
  if (!bar.signal) return;
  // получить данные по инструменту
  const {
    lots = 0,
    averagePositionPrice = {}
  } = await api.instrumentPortfolio({ figi }) || {};
  // если нет открытых позиций, то ничего не делать
  if (!lots) return;
  // получить список отложенных ордеров по инструменту
  const orders = (await api.orders() || []).filter(item => item.figi === figi);
  // если уже есть отложенные ордера по инструменту, то ничего не делать
  if (orders.length > 0) return;
  // есть сигнал на покупку или продажу
  if (bar.signal === 'Buy') {
    // получить список недавних операций
    const {
      operations = []
    } = await api.operations({
      figi,
      from: new Date(time - YEAR).toJSON(),
      to: new Date(time + HOUR).toJSON()
    });
    // цена и количество последней операции на покупку
    const { price = 0, quantity = 0 } = (operations[0] || {}).operationType === 'Buy' ? operations[0] : {};
    // минимальный лот инструмента
    const { lot } = await api.searchOne({ figi });
    // волатильность за весь период выборки
    const volatility = max / min - 1;
    // отклонение от цены предыдущей операции
    const deviation = Math.abs(price / bar.c - 1);
    // если отклонение цены больше заданной доли от волатильности
    if (averagePositionPrice.value > bar.c && quantity > 0 && deviation > volatility * nconf.get('movement')) {
      const order = await api.limitOrder({
        figi,
        lots: Math.ceil(quantity / lot),
        price: bar.c,
        operation: 'Buy'
      });
      console.log(new Date(time).toJSON(), order.orderId, bar.figi, bar.signal, bar.c, order);
    }
  } else if (bar.signal === 'Sell') {
    // доля изменения цены относительно средней
    const profit = bar.c / averagePositionPrice.value - 1;
    // изменение цены больше заданной доли в плюс
    if (profit > nconf.get('profit')) {
      const order = await api.limitOrder({
        figi,
        lots,
        price: bar.c,
        operation: 'Sell'
      });
      console.log(new Date(time).toJSON(), order.orderId, bar.figi, bar.signal, bar.c, order);
    }
  }
}

const api = new OpenAPI({
  apiURL: nconf.get('apiurl'),
  socketURL: nconf.get('socketurl'),
  secretToken: nconf.get('token')
});
let time;
setInterval(async function() {
  const now = new Date();
  now.setUTCMinutes(0);
  now.setUTCSeconds(0);
  now.setUTCMilliseconds(0);
  if (time !== now.getTime()) {
    time = now.getTime();
    const { positions = [] } = await api.portfolio();
    positions.filter(position => position.instrumentType === 'Stock').forEach(async function(position) {
      try {
        await run(time, position.figi);
      } catch (err) {
        console.log(now.toJSON(), err);
      }
    });
  }
}, 1000);

const app = express();
app.enable('trust proxy');
app.disable('x-powered-by');
app.use(bodyParser.json());
app.use(express.static('public'));
app.get('/api/candles', async function(req, res) {
  const HOUR = 60 * 60 * 1000;
  const WEEK = 7 * 24 * HOUR;
  const now = new Date();
  const ticker = (req.query.ticker || '').toLowerCase();
  const interval = req.query.interval || 'hour';
  const { figi } = await api.searchOne({ ticker });
  const { candles } = await api.candlesGet({
    figi,
    interval,
    from: new Date(now - WEEK).toJSON(),
    to: new Date(now).toJSON()
  });
  // вычислить EMA и точки пересечения
  let fastEMA, slowEMA;
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    bar.time = new Date(bar.time).getTime();
    const price = (bar.h + bar.l + bar.o + bar.c) / 4;
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
    price: candles[candles.length - 1].c,
    averagePositionPrice: averagePositionPrice.value,
    expectedYield: expectedYield.value,
    candles
  });
});
app.listen(nconf.get('port'), nconf.get('host'));
