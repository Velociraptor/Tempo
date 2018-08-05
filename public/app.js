var twitch = window.Twitch.ext;
var searchBox;
var trackIdEntry;
var player;
var audioCtx;
var dsp;

const BEAT_ANALYSIS_TIME = 2.0;
const ANALYSIS_SAMPLES = 4 * 1024;

let auth = {
    consumer_key: "",
    shopId: "2020",
    consumer_secret: "",
    hash_algo: "HMAC-SHA1"
};

let sevenDigital = "https://api.7digital.com/1.2/";
let sevenDigitalStreaming = "https://stream.svc.7digital.net/stream/catalogue";

const oauth = OAuth({
    consumer: {
        key: auth.consumer_key,
        secret: auth.consumer_secret
    },
    signature_method: auth.hash_algo,
    hash_function(base_string, key) {
        return CryptoJS.HmacSHA1(base_string, key).toString(CryptoJS.enc.Base64)
    }
});


var boxSideX = 500;
var boxSideY = 250;
var maxAmp = boxSideY/4.0;
var xoffset = 0;
var yoffset = boxSideY - maxAmp;
var numSections = 200;
var numEcgSections = 4;
var startEcgSection = 20; // number of sections before ECG waveform starts
var endEcgSection = 40;
var xIntrvl = boxSideX/numSections;
var ecgIntrvl = (endEcgSection - startEcgSection)/numEcgSections;
// var ecgYPoints = [0, boxSideY/5, -boxSideY/3, boxSideY/3.25, 0]];
var ecgSlopes = [(boxSideY/5)/ecgIntrvl, (-boxSideY/3-boxSideY/5)/ecgIntrvl, (boxSideY/3.25+boxSideY/3)/ecgIntrvl, (0-boxSideY/3.25)/ecgIntrvl];
var opacityCtr = 0;
var opacityCtrSign = 1;
var opacityMax = 500;
var x = 0;
var y = 0;
var opacityVal = 1.0;
var opacityLeader = numSections;
function drawEcg(event) {
    var c = document.getElementById("myCanvas");
    var ctx = c.getContext("2d");
    var speedBox = document.querySelector('#heart-rate-box');
    var now = audioCtx.currentTime;
    var lastBeat = dsp.beatBuffer.lastBeat;
    var tDiff = now - lastBeat;
    if (tDiff > 1.0)
    {
        yscale = 0.05;
    }
    else
    {
        yscale = 0.05 + 0.3 * (1.0 - tDiff);
    }
    var speed = parseFloat(speedBox.value) / 10.0;
    if (speed != speed)
    {
        speed = 1.0;
    }

    ctx.clearRect(0, 0, 500, 500);
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.moveTo(0, yoffset)
    var ecgSection = 0;
    var ecgSectionCtr = 0;
    for (var i = 0; i < numSections; i++)
    {
        opacityLeader--;
        if (opacityLeader < 0)
        {
            opacityLeader = numSections-1;
        }
        if (i == opacityLeader)
        {
            opacityVal = 1.0;
        }
        else if (i < opacityLeader)
        {
            opacityVal = 1.0 - (opacityLeader - i)/numSections;
        }
        else //(i > opacityLeader)
        {
            opacityVal = 1.0 - (opacityLeader + (numSections-i))/numSections;
        }

        ctx.strokeStyle = "rgba(0,0,255,"+opacityVal+")";
        x = xoffset + xIntrvl * i;
        if ((i < startEcgSection) || (i > endEcgSection))
        {
            // sections are straight horizontal
            y = yoffset;
        }
        else
        {
            // ecg waveform, interpolate between listed points evenly
            ecgSectionCtr++;
            if (ecgSectionCtr > ecgIntrvl)
            {
                ecgSection++;
                ecgSectionCtr = 0;
            }
            if (ecgSection > numEcgSections - 1) {ecgSection = 3;}
            y = y + ecgSlopes[ecgSection]*xIntrvl*yscale;
        }
        ctx.lineTo(x, y);
        ctx.stroke();
    }
    ctx.lineTo(boxSideX, yoffset);
    ctx.stroke();
    ctx.restore();

    xoffset += speed;
    if (xoffset > boxSideX)
    {
        xoffset = -20*xIntrvl;
    }
    window.requestAnimationFrame(drawEcg);
}


function doSearch(event) {
    twitch.rig.log(searchBox.value);
    var req = {
        type: 'GET',
        dataType: "xml",
        url: 'https://api.7digital.com/1.2/track/search',
        success: updateResults,
        error: logError,
        data: {
            usageTypes: "adsupportedstreaming",
            oauth_consumer_key: "7d4vr6cgb392",
            shopId: "2020",
            q: searchBox.value
        }
    };
    $.ajax(req);
    drawEcg();
}
// 1271215
// 4720877

function updateResults(result, status, obj) {
    console.log(status);
    console.log(result);
}

function doTrackIdRequest(event) {
    console.log(trackIdEntry.value);
    const request_data = {
        url: sevenDigitalStreaming,
        method: 'GET',
        data: {
            trackId: trackIdEntry.value,
            shopId: auth.shopId
        }
    };
    var p = oauth.authorize(request_data);
    var uri = sevenDigitalStreaming + "?" + $.param(p);

    player.src = uri;

    var my_dsp = {
        sourceElement: audioCtx.createMediaElementSource(player),
        analyzer: audioCtx.createAnalyser(),
        lpFilt: audioCtx.createBiquadFilter(),
        delay: audioCtx.createDelay(),
        scriptProcessor: audioCtx.createScriptProcessor(ANALYSIS_SAMPLES, 2, 2),
        beatBuffer: {
            data: null,
            size: null,
            cursor: 0,
            lastBeat: audioCtx.currentTime,
            beatActive: false
        }
    };
    // console.log("audio source has " + my_dsp.sourceElement.channelCount + " channels");
    // console.log("audio source sample rate is " + my_dsp.sourceElement.sampleRate + " Hz");

    var sampleTime = 1.0 / 44100.0;
    var bufferTime = ANALYSIS_SAMPLES * sampleTime;
    var beatEnergySamples = BEAT_ANALYSIS_TIME / bufferTime;
    my_dsp.beatBuffer.size = Math.ceil(beatEnergySamples);
    my_dsp.beatBuffer.data = new Float32Array(my_dsp.beatBuffer.size);
    my_dsp.analyzer.fftSize = ANALYSIS_SAMPLES;
    my_dsp.scriptProcessor.onaudioprocess = audioProcess;
    my_dsp.lpFilt.type = "lowpass";
    my_dsp.lpFilt.frequency.value = 200;
    my_dsp.delay.delayTime.value = 0.15;

    my_dsp.sourceElement.connect(my_dsp.analyzer);
    my_dsp.analyzer.connect(my_dsp.lpFilt);
    my_dsp.analyzer.connect(my_dsp.delay);
    my_dsp.lpFilt.connect(my_dsp.scriptProcessor);
    my_dsp.scriptProcessor.connect(audioCtx.destination);
    my_dsp.delay.connect(audioCtx.destination);
    my_dsp.sourceElement.mediaElement.play();
    dsp = my_dsp;
    drawEcg();
}

function audioProcess(event) {
    var inputBuffer = event.inputBuffer;
    var outputBuffer = event.outputBuffer;
    var leftIn = inputBuffer.getChannelData(0);
    var rightIn = inputBuffer.getChannelData(1);
    var leftOut = outputBuffer.getChannelData(0);
    var rightOut = outputBuffer.getChannelData(1);
    var energy = 0.0;

    for (var i = 0; i < inputBuffer.length; i++) {
        energy = energy + leftIn[i] * leftIn[i] + rightIn[i] * rightIn[i];
    }
    const bufIndex = dsp.beatBuffer.cursor % dsp.beatBuffer.size;
    dsp.beatBuffer.data[bufIndex] = energy;
    dsp.beatBuffer.cursor = dsp.beatBuffer.cursor + 1;

    if (dsp.beatBuffer.cursor >= dsp.beatBuffer.size) {
        var mvgAvg = 0.0;
        for (var i = 0; i < dsp.beatBuffer.size; i++) {
            mvgAvg = mvgAvg + dsp.beatBuffer.data[i];
        }
        mvgAvg = mvgAvg / dsp.beatBuffer.size;
        thres = 700.0;
        // console.log({energy: energy, thres: thres})
        if (energy > thres) {
            if (!dsp.beatBuffer.beatActive)
            {
                dsp.beatBuffer.beatActive = true;
                dsp.beatBuffer.lastBeat = audioCtx.currentTime;
                console.log("beat");
            }
        }
        else {
            dsp.beatBuffer.beatActive = false;
        }
    }
}


document.addEventListener('DOMContentLoaded', function() {
    // searchBox = document.querySelector('#search-box');
    // searchBox.onchange = doSearch;
    trackIdEntry = document.querySelector('#track-id-entry');
    trackIdEntry.onchange = doTrackIdRequest;
    player = document.querySelector('#player');
    audioCtx = new AudioContext();
}, false);

var token = "";
var tuid = "";
var ebs = "";

// create the request options for our Twitch API calls
var requests = {
    set: createRequest('POST', 'cycle'),
    get: createRequest('GET', 'query')
};

function createRequest(type, method) {

    return {
        type: type,
        url: 'https://localhost:8081/color/' + method,
        success: updateBlock,
        error: logError
    }
}

function setAuth(token) {
    Object.keys(requests).forEach((req) => {
        twitch.rig.log('Setting auth headers');
        requests[req].headers = { 'Authorization': 'Bearer ' + token }
    });
}

twitch.onContext(function(context) {
    twitch.rig.log(context);
});

twitch.onAuthorized(function(auth) {
    // save our credentials
    token = auth.token;
    tuid = auth.userId;

    setAuth(token);
    // $.ajax(requests.get);
});

function updateBlock(hex) {
    twitch.rig.log('Updating block color');
}

function logError(_, error, status) {
  twitch.rig.log('EBS request returned '+status+' ('+error+')');
}

function logSuccess(hex, status) {
  // we could also use the output to update the block synchronously here,
  // but we want all views to get the same broadcast response at the same time.
  twitch.rig.log('EBS request returned '+hex+' ('+status+')');
}

$(function() {

    // when we click the cycle button
    $('#cycle').click(function() {
        if(!token) { return twitch.rig.log('Not authorized'); }
        twitch.rig.log('Requesting a color cycle');
        $.ajax(requests.set);
    });

    // listen for incoming broadcast message from our EBS
    twitch.listen('broadcast', function (target, contentType, color) {
        twitch.rig.log('Received broadcast color');
        updateBlock(color);
    });
});
