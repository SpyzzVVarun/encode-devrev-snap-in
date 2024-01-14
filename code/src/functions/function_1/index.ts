// Imports
import axios from 'axios'
import { client } from "@devrev/typescript-sdk";
import sgMail from '@sendgrid/mail';
import { Octokit } from "@octokit/rest";
import * as _ from './env'
import { check } from 'yargs';
sgMail.setApiKey(_.SENDGRID_API_KEY);

async function createMailingList(apiUrl: string, headers: Record<string, string>): Promise<{ name: string; email: string }[]> {
  try {
    const response = await axios.get(apiUrl, { headers });
    const data = response.data;

    interface User {
      name: string;
      email: string;
    }

    const userList: User[] = data.rev_users;
    let mailingList: { name: string; email: string }[] = [];

    for (let user of userList) {
      if (user.email !== undefined && user.name !== undefined) {
        mailingList.push({ name: user.name, email: user.email });
      }
      else if (user.email !== undefined){
        mailingList.push({ name: "customer", email: user.email });
      }
    }

    return mailingList;
  } catch (error) {
    console.error('Error:', error);
    return [{ name: "error", email: "error" }];
  }
}

async function sendMail(mailId: string, startDate: number, servuct: string, companyName: string, customerName: string) {
  const msg = {
    to: mailId, // recipient email
    from: _.mailSender, // verified sender
    subject: `Share Your Experience with ${servuct} - Your Feedback Matters!`,
    // sendAt: startDate,
    html: `<p>Dear ${customerName},</p>
    <p>At ${companyName}, we're always striving to enhance ${servuct} to meet your needs. Your feedback is vital in guiding our efforts and ensuring we deliver the best experience possible with ${servuct}. We invite you to participate in our survey about ${servuct}. </p>
    <p>It won't take more than a few minutes, and your insights will directly influence the improvements we make.</p>
    <p><a href="${_.surveyLink}">${_.surveyLink}</a></p>
    <p>Your responses will remain confidential and will be used solely for improving ${servuct} and understanding our customers better. As part of our commitment to continuous improvement, we highly value your opinion and look forward to your valuable feedback on ${servuct}. </p>
    <p>Thank you for being a part of the ${companyName} community and for using [Service/Product Name]. Your input is instrumental in shaping our future.</p>
    <p>Warm regards,<br>The ${companyName} Team</p>`,
  };

  // Send the email
  try {
    await sgMail.send(msg);
    console.log('Email sent to', mailId);
  } catch (error: any) {
    console.error('Error sending email to', mailId, ':', error);
  }
}

async function commitJsonChange(filePath: string, updates: Record<string, any>) {
  
  const fetch = await import("node-fetch");
  const octokit = new Octokit({ auth: _.GITHUB_AUTH, request: {fetch}});

  try {
      // Fetch the current JSON file
      const { data: fileData } = await octokit.repos.getContent({
          owner: _.owner,
          repo: _.repo,
          path: filePath,
      });

      if ('content' in fileData && 'sha' in fileData) {
          const sha = fileData.sha;
          let jsonContent = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
      
          // Update the JSON content
          for (const [key, value] of Object.entries(updates)) {
              jsonContent[key] = value;
          }
      
          // Commit the updated JSON file
          await octokit.repos.createOrUpdateFileContents({
              owner: _.owner,
              repo: _.repo,
              path: filePath,
              message: `Update JSON configuration in ${filePath}`,
              content: Buffer.from(JSON.stringify(jsonContent, null, 2)).toString('base64'),
              sha,
          });
      
          console.log(`${filePath} updated successfully`);
      } else {
          console.error(`Error: ${filePath} is not a file or does not exist`);
      }
  } catch (error) {
      console.error(`Error updating ${filePath}:`, error);
  }
}


async function handleEvent(
  event: any,
) {
  const devrevPAT = event.context.secrets.service_account_token;
  const API_BASE = event.execution_metadata.devrev_endpoint;
  
  const devrevSDK = client.setup({
    endpoint: API_BASE,
    token: devrevPAT,
  })

  const workCreated = event.payload.work_created.work;
  const startDate = event.input_data.global_values.start_date;
  const PAT = event.input_data.global_values.PAT;
  const servuct = event.input_data.global_values.survey_config[2];
  const improvements = event.input_data.global_values.survey_config[3];
  const disappointing = event.input_data.global_values.survey_config[5];
  let checkboxes = [];
  for(let i = 6; i<15; i++){
    if(event.input_data.global_values.survey_config[i] === undefined){
      break;
    }
    checkboxes.push(event.input_data.global_values.survey_config[i]);
  }
  const companyName = event.input_data.global_values.survey_config[1];
  let creatorName = workCreated.created_by.name
  if (creatorName === undefined){
    creatorName = event.input_data.global_values.survey_config[0];
  }
  let bodyComment = `
  Survey has been created by ${creatorName}.\n 
  Here is the Link to the Survey Form: ${_.surveyLink}.\n
  Here is the Link to the Analytics Dashboard: ${_.analyticsLink}.
  `; 
  
  // Define the updates to be made
  const jsonUpdatesBackend = {
    'survey': companyName + "_" + servuct + "_0",
    'PAT': PAT
  };
  // Path to the JSON file in the repository
  const jsonFilePathBackend = 'backend/constants.json';
  // Update the JSON file
  await commitJsonChange(jsonFilePathBackend, jsonUpdatesBackend);

  // Define the updates to be made
  const jsonUpdatesClient = {
    "productName" : servuct,
    "disappointing" : disappointing,
    "improvements" : improvements,
    "checkboxes" : checkboxes
  };
  // Path to the JSON file in the repository
  const jsonFilePathClient = 'client/src/constants.json';
  // Update the JSON file
  await commitJsonChange(jsonFilePathClient, jsonUpdatesClient);

  const body = {
    object: workCreated.id,
    type: 'timeline_comment',
    body:  bodyComment,
  }
  const headers = {
    'Authorization': 'eyJhbGciOiJSUzI1NiIsImlzcyI6Imh0dHBzOi8vYXV0aC10b2tlbi5kZXZyZXYuYWkvIiwia2lkIjoic3RzX2tpZF9yc2EiLCJ0eXAiOiJKV1QifQ.eyJhdWQiOlsiamFudXMiXSwiYXpwIjoiZG9uOmlkZW50aXR5OmR2cnYtdXMtMTpkZXZvL2ljdTNWSjd6OmRldnUvMSIsImV4cCI6MTc5ODk2NTAwOSwiaHR0cDovL2RldnJldi5haS9hdXRoMF91aWQiOiJkb246aWRlbnRpdHk6ZHZydi11cy0xOmRldm8vc3VwZXI6YXV0aDBfdXNlci9vaWRjfHBhc3N3b3JkbGVzc3xlbWFpbHw2NTRiYmIyY2FkZGY2YTg3ZmViN2RkNjkiLCJodHRwOi8vZGV2cmV2LmFpL2F1dGgwX3VzZXJfaWQiOiJvaWRjfHBhc3N3b3JkbGVzc3xlbWFpbHw2NTRiYmIyY2FkZGY2YTg3ZmViN2RkNjkiLCJodHRwOi8vZGV2cmV2LmFpL2Rldm9fZG9uIjoiZG9uOmlkZW50aXR5OmR2cnYtdXMtMTpkZXZvL2ljdTNWSjd6IiwiaHR0cDovL2RldnJldi5haS9kZXZvaWQiOiJERVYtaWN1M1ZKN3oiLCJodHRwOi8vZGV2cmV2LmFpL2RldnVpZCI6IkRFVlUtMSIsImh0dHA6Ly9kZXZyZXYuYWkvZGlzcGxheW5hbWUiOiJuLXZhcnVuIiwiaHR0cDovL2RldnJldi5haS9lbWFpbCI6Im4udmFydW5AaWl0Zy5hYy5pbiIsImh0dHA6Ly9kZXZyZXYuYWkvZnVsbG5hbWUiOiJWYXJ1biBOYWdwYWwiLCJodHRwOi8vZGV2cmV2LmFpL2lzX3ZlcmlmaWVkIjp0cnVlLCJodHRwOi8vZGV2cmV2LmFpL3Rva2VudHlwZSI6InVybjpkZXZyZXY6cGFyYW1zOm9hdXRoOnRva2VuLXR5cGU6cGF0IiwiaWF0IjoxNzA0MzU3MDA5LCJpc3MiOiJodHRwczovL2F1dGgtdG9rZW4uZGV2cmV2LmFpLyIsImp0aSI6ImRvbjppZGVudGl0eTpkdnJ2LXVzLTE6ZGV2by9pY3UzVko3ejp0b2tlbi8zb2RQZ1pqZiIsIm9yZ19pZCI6Im9yZ19uU20wdWpTQk0xcmp4Z3Z0Iiwic3ViIjoiZG9uOmlkZW50aXR5OmR2cnYtdXMtMTpkZXZvL2ljdTNWSjd6OmRldnUvMSJ9.0oyFzajxkYqBGoluxRYMDIKoOCEtCbq0FJdfgzZMpn2j3imzrvkWkJs0XpRW4Wjg7Jien1I6U0Ee19-TuzhHOtiYBUIaTG0H_yw5zOqO0DSknU--smi9Dok6-bhIQg1KL2eNQJZZ-wQ3Z9UcRwrs3Nwfpb8cWU2yn4UHsWG67bFZps2Pk5CRQONmlGGleWMF97UK84i2QIhJ5kscNqJ0e6moraEyLw389fJiuUl8IF_26zwua-JMAbbYpP-xbPPUIokHCwLVd6ZLYLxD2jhIAJnqGx9bUvDz2BzZhBAFaQmmewtZ9NSkJLQouK34VZMU_6mii9777kMR75wIjhNcLg',
  };
  const mailingList: { name: string; email: string }[] = await (async () => {
      const mailingList: { name: string; email: string }[] = await createMailingList(_.apiURL, headers);
      return mailingList;
  })();  
  if ((workCreated.type == "issue" && mailingList[0].name !== "error" && workCreated.applies_to_part.name == "Surveys")){
    const response = await devrevSDK.timelineEntriesCreate(body as any);
    const mailPromises = mailingList.map(mailId => sendMail(mailId.email, startDate, servuct, companyName, mailId.name));
    Promise.all(mailPromises).then(() => {
      console.log('All emails sent');
    });
    return response;
  }
  if ((workCreated.type == "issue" && mailingList[0].name !== "error" && workCreated.applies_to_part.name == "Surveys")){
    const rejectBody = {
      object: workCreated.id,
      type: 'timeline_comment',
      body:  "Survey not sent to the entire mailing list",
    }
    const rejectResponse = await devrevSDK.timelineEntriesCreate(rejectBody as any);
    return rejectResponse;
  }
  
  return undefined;
  
}

export const run = async (events: any[]) => {
  console.info('events', JSON.stringify(events), '\n\n\n');
  for (let event of events) {
    const resp = await handleEvent(event);
    // console.log(JSON.stringify(resp.data));
  }
};

export default run;

