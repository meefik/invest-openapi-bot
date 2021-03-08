/* global Highcharts */
Highcharts.getJSON('/api/candles', function (data) {
  // split the data set into ohlc and volume
  var ohlc = [],
    volume = [],
    fastEMA = [],
    slowEMA = [],
    signals = [];

  for (var i = 0; i < data.length; i++) {
    ohlc.push([
      data[i].time, // the date
      data[i].o, // open
      data[i].h, // high
      data[i].l, // low
      data[i].c // close
    ]);

    volume.push([
      data[i].time, // the date
      data[i].v // the volume
    ]);

    fastEMA.push([
      data[i].time, // the date
      data[i].fastEMA // the fast EMA
    ]);

    slowEMA.push([
      data[i].time, // the date
      data[i].slowEMA // the fast EMA
    ]);

    if (data[i].signal === 'Buy') {
      signals.push({
        value: new Date(data[i].time), // the date
        color: 'green',
        dashStyle: 'Dot',
        x: new Date(data[i].time),
        title: 'B',
        text: 'Buy'
      });
    }
    if (data[i].signal === 'Sell') {
      signals.push({
        value: new Date(data[i].time), // the date
        color: 'red',
        dashStyle: 'Dot',
        x: new Date(data[i].time),
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
      }
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