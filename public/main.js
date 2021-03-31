/* global Highcharts */
var params = new URL(location.href).searchParams;
Highcharts.getJSON(`/api/candles?ticker=${params.get('ticker')}`, function (data) {
  var candles = data.candles;
  var price = data.price;
  var averagePositionPrice = data.averagePositionPrice || 0;
  var expectedYield = data.expectedYield || 0;
  var profit = 100 * price / averagePositionPrice - 100;
  var lots = data.lots;
  // split the data set into ohlc and volume
  var ohlc = [],
    volume = [],
    fastEMA = [],
    slowEMA = [],
    signals = [];

  for (var i = 0; i < candles.length; i++) {
    ohlc.push([
      candles[i].time, // the date
      candles[i].o, // open
      candles[i].h, // high
      candles[i].l, // low
      candles[i].c // close
    ]);

    volume.push([
      candles[i].time, // the date
      candles[i].v // the volume
    ]);

    fastEMA.push([
      candles[i].time, // the date
      candles[i].fastEMA // the fast EMA
    ]);

    slowEMA.push([
      candles[i].time, // the date
      candles[i].slowEMA // the fast EMA
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
          text: expectedYield ? expectedYield + ' (' + profit.toFixed(2) + '%)' : ''
        }
      }, {
        value: averagePositionPrice,
        color: 'green',
        dashStyle: 'shortdash',
        width: 2,
        label: {
          text: lots + ' lots'
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
      type: 'flags',
      shape: 'circlepin',
      width: 14,
      height: 14,
      onSeries: 'instrument',
      data: signals
    }]
  });
});