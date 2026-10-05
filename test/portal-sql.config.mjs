import config from './playwright.config.mjs';
// Keep verification away from the application's existing server on port 5173.
const port=5197;
export default {...config,
 reporter:[['list'],['json',{outputFile:process.cwd()+'/test/results/portal-sql-browser.json'}]],
 use:{...config.use,baseURL:`http://localhost:${port}`},
 webServer:{...config.webServer,command:config.webServer.command.replaceAll('5173',String(port)),url:`http://localhost:${port}`}};
