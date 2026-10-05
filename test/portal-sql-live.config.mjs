import config from './playwright.config.mjs';
// Live Auth callbacks use the existing compiled server at localhost:5173.
export default {...config,
 reporter:[['list'],['json',{outputFile:process.cwd()+'/test/results/portal-sql-live.json'}]],
 webServer:{...config.webServer,reuseExistingServer:true}};
