import { Before, Given, ITestCaseHookParameter, setDefaultTimeout, Then, When } from "@cucumber/cucumber";
import {
  AccountId,
  Client,
  KeyList,
  PrivateKey,
  TopicCreateTransaction, 
  TopicMessageQuery, TopicMessageSubmitTransaction
} from "@hashgraph/sdk";
import { Account, accounts } from "../../src/config";
import assert from "node:assert";
import { CheckBalance, GetAccount, SignAndExecuteTransaction } from "../../src/common-helper";

// Pre-configured client for test network (testnet)
const client = Client.forTestnet();
//Set the operator with the account ID and private key
let firstPrivKey: PrivateKey;
let firstAccountId: AccountId;
let secondPrivKey: PrivateKey;
let secondAccountId: AccountId;
let thresholdKey: KeyList;
let topicId: string;
let usedAccounts = new Set<number>();

Before(async function (this: any, testCase: ITestCaseHookParameter) {
   // reset per-scenario context
   usedAccounts = new Set<number>();
});

// increase timeout for slow Hedera calls

setDefaultTimeout(60 * 1000);

async function CreateTopic(memo: string, submitKey: KeyList | PrivateKey, privKey: PrivateKey): Promise<string> {
  const tx = await new TopicCreateTransaction()
      .setTopicMemo(memo)
      .setSubmitKey(submitKey)
      .freezeWith(client);
  // Excute transaction and Get the receipt
  const new_receipt = await SignAndExecuteTransaction(client, tx, privKey);
  return new_receipt.topicId ? new_receipt.topicId.toString() : "";
}

Given(/^a first account with more than (\d+) hbars$/, async function (expectedBalance: number) {
  usedAccounts = new Set<number>();
   for (let i = 0; i < accounts.length; i++) {
        if (usedAccounts.has(i)) 
          continue;
        else {
          const accData = GetAccount(i);
          client.setOperator(accData.accountId, accData.privateKey);
          const checkBalance = await CheckBalance(client, accData.accountId);
          if(checkBalance > expectedBalance)
          {
            firstAccountId = accData.accountId;
            firstPrivKey = accData.privateKey;
            usedAccounts.add(i);
            break;
          }

        }
      }
    
    if(!firstAccountId){
      throw new Error("No account with sufficient balance found");
    }
});

When(/^A topic is created with the memo "([^"]*)" with the first account as the submit key$/, async function (memo: string) {
  topicId = await CreateTopic(memo, firstPrivKey, firstPrivKey);

});

When(/^The message "([^"]*)" is published to the topic$/, async function (message: string) {
  const messageTransaction = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message).freezeWith(client).sign(firstPrivKey);
    
    
  await messageTransaction.execute(client);
});

Then(/^The message "([^"]*)" is received by the topic and can be printed to the console$/, async function (message: string) {
  let messageRecieved = false;
  const topicMessage = new TopicMessageQuery()
    .setTopicId(topicId)
    .setStartTime(0)
    .subscribe(
      client,
      (err) => {
        console.error("Subscription error:", err);
      },
      (res) => {
        try {
          const decodedContent = Buffer.from(res.contents).toString();
          console.log("Received message: ", decodedContent);
          assert.strictEqual(decodedContent, message);
          messageRecieved = true;
          if (topicMessage) topicMessage.unsubscribe();
        } catch (err) {
          console.error("Error processing message:", err);
        }
      }
    );
});

Given(/^A second account with more than (\d+) hbars$/, async function (expectedBalance: number) {
  for (let i = 0; i < accounts.length; i++) {
        if (usedAccounts.has(i)) 
          continue;
        else {
          const accData = GetAccount(i);
          client.setOperator(accData.accountId, accData.privateKey);
          const checkBalance = await CheckBalance(client, accData.accountId);
          if(checkBalance > expectedBalance)
          {
            secondAccountId = accData.accountId;
            secondPrivKey = accData.privateKey;
            usedAccounts.add(i);
            break;
          }
        }
      }
    
    if(!secondAccountId){
      throw new Error("No account with sufficient balance found");
    }
});

Given(/^A (\d+) of (\d+) threshold key with the first and second account$/, async function (threshold: number, totalKeys: number) {
  const publicKeyList = [];
  for (let i = 0; i < totalKeys; i += 1) {
      const privateKey = PrivateKey.fromStringED25519(accounts[i].privateKey);
      const publicKey = privateKey.publicKey;
      publicKeyList.push(publicKey);
  }

  thresholdKey = new KeyList(publicKeyList, threshold);
});

When(/^A topic is created with the memo "([^"]*)" with the threshold key as the submit key$/, async function (memo: string) {
    topicId = await CreateTopic(memo, thresholdKey, firstPrivKey);
});
