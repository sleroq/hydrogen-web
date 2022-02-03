/*
Copyright 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import type {HomeServerApi} from "../../net/HomeServerApi";
import type {AccountDetails, AuthenticationData, RegistrationParams} from "../types";

export abstract class BaseRegistrationStage {
    protected _hsApi: HomeServerApi;
    protected _accountDetails: AccountDetails;
    protected _session: string;
    protected _nextStage: BaseRegistrationStage;
    protected _params?: Record<string, any>

    constructor(hsApi: HomeServerApi, accountDetails: AccountDetails, session: string, params?: RegistrationParams) {
        this._hsApi = hsApi;
        this._accountDetails = accountDetails;
        this._session = session;
        this._params = params;
    }

    /**
     * eg: m.login.recaptcha or m.login.dummy
     */
    abstract get type(): string;

    /**
     * This method should return auth part that must be provided to
     * /register endpoint to successfully complete this stage
     */
    abstract generateAuthenticationData(): AuthenticationData;

    setNextStage(stage: BaseRegistrationStage) {
        this._nextStage = stage;
    }

    get nextStage(): BaseRegistrationStage {
        return this._nextStage;
    }
}