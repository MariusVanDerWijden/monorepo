import { Node } from "@counterfactual/types";
import Queue from "p-queue";
import { jsonRpcMethod } from "rpc-server";

import { RequestHandler } from "../../../request-handler";
import { getFirstElementInListNotEqualTo } from "../../../utils";
import { NodeController } from "../../controller";
import {
  APP_ALREADY_UNINSTALLED,
  CANNOT_UNINSTALL_FREE_BALANCE,
  NO_APP_INSTANCE_ID_TO_UNINSTALL
} from "../../errors";

import { uninstallAppInstanceFromChannel } from "./operation";

export default class UninstallController extends NodeController {
  @jsonRpcMethod(Node.RpcMethodName.UNINSTALL)
  public executeMethod = super.executeMethod;

  protected async enqueueByShard(
    requestHandler: RequestHandler,
    params: Node.UninstallVirtualParams
  ): Promise<Queue[]> {
    const { store } = requestHandler;
    const { appInstanceId } = params;

    const sc = await store.getChannelFromAppInstanceID(appInstanceId);
    if (sc.freeBalance.identityHash === appInstanceId) {
      throw Error(CANNOT_UNINSTALL_FREE_BALANCE(sc.multisigAddress));
    }

    return [
      requestHandler.getShardedQueue(
        await store.getMultisigAddressFromAppInstance(sc.multisigAddress)
      )
    ];
  }

  protected async beforeExecution(
    // @ts-ignore
    requestHandler: RequestHandler,
    params: Node.UninstallParams
  ) {
    const { appInstanceId } = params;

    if (!appInstanceId) {
      throw Error(NO_APP_INSTANCE_ID_TO_UNINSTALL);
    }
  }

  protected async executeMethodImplementation(
    requestHandler: RequestHandler,
    params: Node.UninstallParams
  ): Promise<Node.UninstallResult> {
    const { store, instructionExecutor, publicIdentifier } = requestHandler;
    const { appInstanceId } = params;

    if (!appInstanceId) {
      throw Error(NO_APP_INSTANCE_ID_TO_UNINSTALL);
    }

    const stateChannel = await store.getChannelFromAppInstanceID(appInstanceId);

    if (!stateChannel.hasAppInstance(appInstanceId)) {
      throw Error(APP_ALREADY_UNINSTALLED(appInstanceId));
    }

    const to = getFirstElementInListNotEqualTo(
      publicIdentifier,
      stateChannel.userNeuteredExtendedKeys
    );

    await uninstallAppInstanceFromChannel(
      store,
      instructionExecutor,
      publicIdentifier,
      to,
      appInstanceId
    );

    return { appInstanceId };
  }
}
