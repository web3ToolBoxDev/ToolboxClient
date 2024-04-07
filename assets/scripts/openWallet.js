const webSocket = require('ws');
const url = process.argv[2];
const puppeteer = require('puppeteer-extra');
const lanPlugin = require('puppeteer-extra-plugin-stealth/evasions/navigator.languages');
const userAgentPlugin = require('puppeteer-extra-plugin-stealth/evasions/user-agent-override');
const webglPlugin = require('puppeteer-extra-plugin-stealth/evasions/webgl.vendor');
const path = require('path');
// const findChrome = require('carlo/lib/find_chrome');

const proxyManager = require('./proxy/index');
let ChromeLauncher;
import('chrome-launcher').then((module) => {
    ChromeLauncher = module;
});

console.log('收到的URL参数:', url);

let ws = new webSocket(url);
let webSocketReady = false;
let taskData = null;

// 心跳包定时发送
function sendHeartBeat() {
    setInterval(() => {
        if (ws.readyState === webSocket.OPEN) {
            const heartBeatMessage = JSON.stringify({
                type: 'heart_beat'
            });
            ws.send(heartBeatMessage);
        }
    }, 5000); // 每 5 秒发送一次心跳包
}

function sendRequestTaskData() {
    if (ws.readyState === webSocket.OPEN) {
        const requestTaskDataMessage = JSON.stringify({
            type: 'request_task_data',
            data: ''
        });
        ws.send(requestTaskDataMessage);
    }
}

function sendTaskLog(log) {
    if (ws.readyState === webSocket.OPEN) {
        const taskLogMessage = JSON.stringify({
            type: 'task_log',
            message: log
        });
        ws.send(taskLogMessage);
    }
}

function sendTaskCompleted() {
    if (ws.readyState === webSocket.OPEN) {
        const taskCompletedMessage = JSON.stringify({
            type: 'task_completed'
        });
        ws.send(taskCompletedMessage);
    }
}
function sendTerminateProcess() {
    if (ws.readyState === webSocket.OPEN) {
        const terminateProcessMessage = JSON.stringify({
            type: 'terminate_process'
        });
        ws.send(terminateProcessMessage);
    }
}
function exit() {
    ws.close();
    process.exit(0);
}

ws.on('open', () => {
    webSocketReady = true;
    sendHeartBeat();
});

ws.on('message', (message) => {
    let data = JSON.parse(message);
    switch (data.type) {
        case 'heart_beat':
            break;
        case 'request_task_data':
            console.log('收到任务数据:', data);
            taskData = JSON.parse(data.data);
            break;
        case 'terminate_process':
            sendTerminateProcess();
            exit();
        default:
            break;
    }
});

ws.on('error', (error) => {
    console.error('WebSocket连接发生错误:', error);
    // 关闭连接并退出
    ws.close();
    process.exit(1);
});

// 定时检查连接状态，如果连接断开则重连
setInterval(() => {
    if (ws.readyState === webSocket.CLOSED) {
        console.log('WebSocket连接断开，尝试重新连接...');
        ws = new webSocket(url);
    }
}, 5000); // 每 5 秒检查一次连接状态

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let closeSignal = false;
// 检测浏览器是否关闭
async function checkBrowserClosed(browser) {
    while (!closeSignal) {
        await sleep(5000);
    }
    await proxyManager.stop();
    await browser.close();
    exit();
}
async function openWallet(browser) {
    const page = await browser.newPage();
    await page.goto('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html#initialize/unlock')
    await sleep(5000);
    try {
        await page.waitForSelector('#password');
        await page.type('#password', 'web3ToolBox',{delay:50});
        
        await sleep(2000);
        const element3 = await page.waitForSelector('[data-testid="unlock-submit"]');
        await element3.click();
    }catch(error){
        console.log('error:',error);
    }
}

async function openPhantomWallet(browser) {
    const page = await browser.newPage();
    await page.goto('chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa/popup.html')
    await sleep(5000);
    try {
        
        await page.type('input[data-testid="unlock-form-password-input"]', 'web3ToolBox', { delay: 50 })
        await sleep(2000);
        await page.click('button[data-testid="unlock-form-submit-button"]');
    }catch(error){
        console.log('error:',error);
    }
}

async function opentTwitter(browser,token) {
    const twitterPage = await browser.newPage();
    await twitterPage.goto('https://twitter.com');
    await sleep(5000);
    const cookies = await twitterPage.cookies();
    let update = true;
    // 打印每个 cookie 的信息
    cookies.forEach(cookie => {

        if (cookie.name === 'auth_token') {
            console.log('auth_token or not:', cookie.value === `"${token.replace('"', '')}"`);
           if (cookie.value === `"${token.replace('"', '')}"`) {
                
                update = false;
           }
        }
    });
    if (update) {
        console.log('更新cookie');
        try {
            await twitterPage.evaluate((token) => {
                function modifyCookie(cookieName, cookieValue, domain, path) {
                    document.cookie = `${cookieName}=${cookieValue};domain=${domain};path=${path};Secure`;
                }

                function Login(token) {
                    modifyCookie('auth_token', `"${token.replace('"', '')}"`, 'twitter.com', '/');
                    window.location.replace('https://twitter.com');
                }
                Login(token);

            }, token);
        } catch (e) {
            console.log('登录失败:', e);
        }
    }
}
async function openDiscord(browser,discordToken) {
    const discordPage = await browser.newPage();
    const bypassLocalStorageOverride = (page) =>
    page.evaluateOnNewDocument(() => {
      // Preserve localStorage as separate var to keep it before any overrides
      let __ls = localStorage;

      // Restrict closure overrides to break global context reference to localStorage
      Object.defineProperty(window, "localStorage", {
        writable: false,
        configurable: false,
        value: __ls,
      });
    });
    
    bypassLocalStorageOverride(discordPage);
    await discordPage.goto("https://discord.com/app");
  
    // Setting token into Discord Local Storage (Don't worry it's not being sent/stored anywhere, this is how Discord does it)
    await discordPage.evaluate((token) => {
      console.log("newToken",token);
      const originToken = localStorage.getItem("token");
      console.log("originToken:",originToken);
      if (originToken !== token){
        localStorage.setItem("token", `"${token}"`);
        window.location.reload();
      }
    }, discordToken);
}

// 进行任务逻辑
async function runTask() {
    console.log('任务开始执行');
    const chromePath = ChromeLauncher.Launcher.getInstallations();
    let wallet = taskData;
    if (wallet.language)
        puppeteer.use(lanPlugin({ language: wallet.language.split(',') }));
    if (wallet.userAgent)
        puppeteer.use(userAgentPlugin({ userAgent: wallet.userAgent }));
    if (wallet.webglVendor && wallet.webglRenderer)
        puppeteer.use(webglPlugin({ vendor: wallet.webglVendor, renderer: wallet.webglRenderer }));
    let metamaskEx = path.resolve(__dirname, './extensions/nkbihfbeogaeaoehlefnkodbefgpgknn/10.22.2_0');
    let phantomEx = path.resolve(__dirname, './extensions/bfnaelmomeimhlpmgjnjophhpkkoljpa/24.5.0_0');
    let argArr = [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disabled-setupid-sandbox',
        '--disable-infobars',
        // 添加更多的扩展，使用','隔开，并填入路径
        `--disable-extensions-except=${metamaskEx},${phantomEx}`,
        `--load-extensions=${metamaskEx},${phantomEx}`,
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--force-webrtc-ip-handling-policy',
    ];
    if (wallet.ipType && wallet.ipHost && wallet.ipPort){

        if(wallet.ipType === 'socks5'){
            const url = await proxyManager.createSocksServer(wallet.ipHost, wallet.ipPort,wallet.ipUsername,wallet.ipPassword);
            console.log(url);
            argArr.push('--proxy-server=' + url);
        }
        if(wallet.ipType === 'http'){
            const url = await proxyManager.createHttpServer(wallet.ipHost, wallet.ipPort,wallet.ipUsername,wallet.ipPassword);
            console.log(url);
            argArr.push('--proxy-server=' + url);
        }
    }        
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath.executablePath,
        ignoreDefaultArgs: ['--enable-automation'],
        userDataDir: wallet.chromeUserDataPath,
        defaultViewport: null,
        args: argArr
    }); // Change headless to false for debugging
     // 监听浏览器关闭事件
     browser.on('disconnected', () => {
        console.log('Browser disconnected.');
        // 在这里执行您希望在浏览器关闭时进行的操作
        closeSignal = true;
    });

    await sleep(5000)
    const pages = await browser.pages();
    if(pages.length>1){
        for(let i=1;i<pages.length;i++){
            await pages[i].close();
        }
    }
    const page = pages[0];
    await openWallet(browser);
    await openPhantomWallet(browser)
    if(wallet.twitterToken)
        opentTwitter(browser,wallet.twitterToken);
    if(wallet.discordToken)
        openDiscord(browser,wallet.discordToken);
    
    await checkBrowserClosed(browser);
}

(async () => {
    while (true) {
        if (webSocketReady) {
            // console.log('发送任务日志');
            sendRequestTaskData();
            if (taskData) {
                console.log('任务数据:', taskData);
                sendTaskLog('收到任务数据，完成初始化，开始执行任务');
                await runTask();
            }
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 2000);
        });
    }
})();
