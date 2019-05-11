const aConfig = require('config');
const config = aConfig.get('scanner');

var server = process.env.mqttUrl || config.mqtt.url;
const BeaconScanner = require('node-beacon-scanner');
const scanner = new BeaconScanner();
const measuredPower = config.beacon.measuredPower;
const math = require('mathjs');

var mqttUsername = process.env.mqttUsername || config.mqtt.username;
var mqttPassword = process.env.mqttPassword || config.mqtt.password;
var mqttClientId = process.env.mqttClientId || config.mqtt.ClientId;

var mqttOptions = {
  username: mqttUsername,
  password: mqttPassword,
  clientId: mqttClientId
};

var mqtt = require('mqtt');
var client  = mqtt.connect(server, mqttOptions);
var topicBeaconStay = process.env.topicBeaconStay || config.beacon.topicBeaconStay;
var topicBeaconExit = process.env.topicBeaconExit || config.beacon.topicBeaconExit;

var KalmanFilter = require('kalmanjs');
// var kf = new KalmanFilter();

var beaconUUID = process.env.beacon_serivce_uuid || config.beacon.serviceUUID;
var beaconTimeout = config.beacon.beaconTimeout;
var IntervalUpdateAndRemove = config.beacon.IntervalUpdateAndRemove;

const scannerID = process.env.device_name || 'Test';

var maxRssiData = config.beacon.maxRssiDataLength;
var readyToUseRssiData = config.beacon.readyToUseRssiDataLength;

var currentScanner;

var kalmanFilter = new KalmanFilter({R: 0.01, Q: 3});

class Position
{
  constructor(positionX = 0, positionY = 0, positionZ = 0)
  {
    this.x = parseFloat(positionX);
    this.y = parseFloat(positionY);
    this.z = parseFloat(positionZ);
  }
}

// Set an Event handler for becons
scanner.onadvertisement = (ad) => 
{
  //console.log(JSON.stringify(ad, null, '  '));
  //console.log(currentScanner);
  if (ad.hasOwnProperty("iBeacon") && ad.iBeacon.uuid == beaconUUID)  {
    console.log(ad);
    AddOrUpdateBeacon(ad);
    currentScanner.calculateBeaconDistance();
  }
}

// start when connect to mqtt server
client.on('connect', function () {
  // Start scanning
  scanner.startScan().then(() => {
    
    currentScanner = new Scanner();
    currentScanner.id = scannerID;

    setInterval(function(){
      currentScanner.updateBeaconTimeout();
      currentScanner.tryRemoveMissingBeacon();
    }, IntervalUpdateAndRemove);

    console.log('Started to scan.')  ;
  }).catch((error) => {
    console.error(error);
  });
})

Array.prototype.swapItems = function(a, b){
    this[a] = this.splice(b, 1, this[a])[0];
    return this;
}

function GetBeaconIndexFromScanner(id)
{
  for (var i = 0; i < currentScanner.foundBeacons.length; i++)
  {
    if (id == currentScanner.foundBeacons[i].id)
    {
      return i;
    }
  }
  return null;
}


function AddOrUpdateBeacon(ad)
{
  if (IsBeaconExistInScanner(ad))
  {
    // update
    var updateBeacon = GetBeaconFromScanner(ad);
    updateBeacon.rssiData.push(ad.rssi);
    updateBeacon.rssi = ad.rssi;
    updateBeacon.txPower = ad.iBeacon.txPower;
    updateBeacon.lastFindDate = new Date();
    updateBeacon.timeout = beaconTimeout;
    updateBeacon.location = scannerID;
    if (updateBeacon.rssiData.length > updateBeacon.maxRssiData)
    {
      updateBeacon.rssiData.shift();
    }

  }
  else
  {
    // add
    var newFoundBeacon = new Beacon();
    newFoundBeacon.id = ad.id;
    newFoundBeacon.UUID = ad.iBeacon.uuid;
    newFoundBeacon.major = ad.iBeacon.major;
    newFoundBeacon.minor = ad.iBeacon.minor;
    newFoundBeacon.txPower = ad.iBeacon.txPower;
    newFoundBeacon.rssi = ad.rssi;
    newFoundBeacon.rssiData.push(ad.rssi);
    newFoundBeacon.location = scannerID;
    //newFoundBeacon.distance = 0;
    currentScanner.foundBeacons.push(newFoundBeacon);
  }
}

function IsBeaconExistInScanner(ad)
{
  for (var i = 0; i < currentScanner.foundBeacons.length; i++)
  {
    if (ad.id == currentScanner.foundBeacons[i].id)
    {
      return true;
    }
  }
  return false;
}

function GetBeaconFromScanner(ad)
{
  for (var i = 0; i < currentScanner.foundBeacons.length; i++)
  {
    if (ad.id == currentScanner.foundBeacons[i].id)
    {
      return currentScanner.foundBeacons[i];
    }
  }
  return null;
}

function CreateSendData(beacons)
{
  var sendBeacons = [];
  for (var i = 0; i < beacons.length; i++)
  {
    var beacon = beacons[i];
    var sendBeaconData = new Beacon();
    sendBeaconData.name = beacon.name;
    sendBeaconData.id = beacon.id;
    sendBeaconData.UUID = beacon.UUID;
    sendBeaconData.rssi = beacon.rssi;
    sendBeaconData.txPower = beacon.txPower;
    sendBeaconData.distance = beacon.distance;
    sendBeaconData.location = beacon.location;
    sendBeaconData.measuredPower = beacon.measuredPower;
    sendBeaconData.lastFindDate = beacon.lastFindDate;

    delete sendBeaconData.position;
    delete sendBeaconData.localName;
    delete sendBeaconData.rssiData;
    delete sendBeaconData.maxRssiData;
    delete sendBeaconData.readyToUseRssiData;
    delete sendBeaconData.readyForUse;
    delete sendBeaconData.timeout;

    sendBeacons.push(sendBeaconData);
  }

  return sendBeacons;
}

class Beacon
{
  constructor()
  {
    this.name = "";
    this.id = "";
    this.UUID = "";
    this.localName = "";
    this.position = new Position();
    this.rssi = 0;
    this.location = "";
    this.txPower = 0;
    this.rssiData = [];
    this.distance = 0;
    this.measuredPower = measuredPower;
    this.maxRssiData = maxRssiData;
    this.readyToUseRssiData = readyToUseRssiData;
    this.readyForUse = false;
    this.timeout = beaconTimeout;
    this.lastFindDate = new Date();
  }
}

class Scanner
{
  constructor()
  {
    this.id = "";
    this.position = new Position();
    this.foundBeacons = [];
    this.maxFilterDataLengt = 30;
  }
  canGetPosition()
  {
    if (this.foundBeacons.length >= 4)
    {
      for (var i = 0; i < this.foundBeacons.length; i++)
      {
        if (this.foundBeacons[i].readyForUse == false)
        {
          return false;
        }
      }

      return true;
    }
    return false;
  }
  updateBeaconTimeout()
  {
    for (var i = 0; i < this.foundBeacons.length; i++)
    {
      var foundBeacon = this.foundBeacons[i];

      foundBeacon.timeout = foundBeacon.timeout - (new Date() - foundBeacon.lastFindDate)
      foundBeacon.lastFindDate = new Date();

    }
  }
  tryRemoveMissingBeacon()
  {
    var removeBeaconIndex = [];
    var removeBeacon = [];
    for (var i = 0; i < this.foundBeacons.length; i++)
    {
      var foundBeacon = this.foundBeacons[i];

      if (foundBeacon.timeout < 0)
      {
        removeBeaconIndex.push(i);
        removeBeacon.push(foundBeacon);
      }
    }

    for (var i = 0; i < removeBeaconIndex.length; i++)
    {
      this.foundBeacons.splice(removeBeaconIndex[i], 1);
    }

    if (removeBeaconIndex.length > 0)
    {
      console.log('Remove unseen beacon ' + removeBeaconIndex.length + ' unity');

      var sendData = CreateSendData(removeBeacon);
      client.publish(topicBeaconExit, JSON.stringify(sendData));
    }

    if (this.foundBeacons.length > 0)
    {
      console.log('Publish topic');
      var sendData = CreateSendData(this.foundBeacons);
      client.publish(topicBeaconStay, JSON.stringify(sendData));
    }

  }
  calculateBeaconDistance()
  {
    for (var i = 0; i < this.foundBeacons.length; i++)
    {
      var foundBeacon = this.foundBeacons[i];

      var dataConstantKalman = foundBeacon.rssiData.map(function(v) {
        return kalmanFilter.filter(v);
      });

      var useRssi = dataConstantKalman[dataConstantKalman.length - 1];

      var distance = Math.pow(10, (foundBeacon.measuredPower - useRssi)/(10 * 2));

      //foundBeacon.rssi = useRssi;
      foundBeacon.distance = distance;

      if (foundBeacon.rssiData.length > foundBeacon.readyToUseRssiData)
      {
        foundBeacon.readyForUse = true;
      }
    }
  }
}
