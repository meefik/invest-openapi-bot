/* global Highcharts */
const params = new URL(location.href).searchParams;
Highcharts.getJSON(`/api/candles?ticker=${params.get('ticker')}`, function(data) {
  const candles = data.candles;
  const price = data.price;
  const averagePositionPrice = data.averagePositionPrice || 0;
  const expectedYield = data.expectedYield || 0;
  const profit = data.profit || 0;
  const lots = data.lots || 0;
  const volatility = data.volatility || 0;
  // split the data set into ohlc and volume
  const ohlc = [];
  const volume = [];
  const fastEMA = [];
  const slowEMA = [];
  const trendEMA = [];
  const signals = [];

  for (let i = 0; i < candles.length; i++) {
    ohlc.push([
      candles[i].time, // the date
      candles[i].o, // open
      candles[i].h, // high
      candles[i].l, // low
      candles[i].c // close
    ]);

    volume.push([
      candles[i].time,
      candles[i].v // volume
    ]);

    fastEMA.push([
      candles[i].time,
      candles[i].fastEMA
    ]);

    slowEMA.push([
      candles[i].time,
      candles[i].slowEMA
    ]);

    trendEMA.push([
      candles[i].time,
      candles[i].trendEMA
    ]);

    if (candles[i].signal === 'Buy') {
      signals.push({
        value: new Date(candles[i].time), // the date
        color: 'green',
        dashStyle: 'Dot',
        x: new Date(candles[i].time),
        title: 'B',
        text: 'Buy'
      });
    }
    if (candles[i].signal === 'Sell') {
      signals.push({
        value: new Date(candles[i].time), // the date
        color: 'red',
        dashStyle: 'Dot',
        x: new Date(candles[i].time),
        title: 'S',
        text: 'Sell'
      });
    }
  }

  // create the chart
  Highcharts.stockChart('container', {
    title: {
      text: 'Kormobot'
    },

    rangeSelector: {
      selected: 0,
      inputEnabled: false
    },

    xAxis: {
      plotLines: signals
    },

    yAxis: [{
      labels: {
        align: 'left'
      },
      height: '90%',
      resize: {
        enabled: true
      },
      plotLines: [{
        value: price,
        color: 'red',
        dashStyle: 'shortdash',
        width: 2,
        label: {
          text: 'lots=' + lots + ', avg=' + averagePositionPrice.toFixed(2) + ', volatility=' + volatility.toFixed(2) + '%, yield=' + expectedYield.toFixed(2) + ', profit=' + profit.toFixed(2) + '%'
        }
      }]
    }, {
      labels: {
        align: 'left'
      },
      top: '90%',
      height: '10%',
      offset: 0
    }],

    tooltip: {
      split: true
    },

    series: [{
      type: 'candlestick',
      name: 'Instrument',
      id: 'instrument',
      data: ohlc
    }, {
      type: 'column',
      name: 'Volume',
      id: 'volume',
      yAxis: 1,
      data: volume
    }, {
      name: 'Fast EMA',
      type: 'line',
      linkedTo: 'instrument',
      data: fastEMA
    }, {
      name: 'Slow EMA',
      type: 'line',
      linkedTo: 'instrument',
      data: slowEMA
    }, {
      name: 'Trend EMA',
      type: 'line',
      linkedTo: 'instrument',
      data: trendEMA
    }, {
      type: 'flags',
      shape: 'circlepin',
      width: 14,
      height: 14,
      onSeries: 'instrument',
      data: signals
    }]
  });
});
