import asyncio
import logging
import os

import aiostream
from zha.application import Platform
from zha.application.const import ZHA_GW_MSG_DEVICE_FULL_INIT
from zha.application.gateway import Device, Gateway
from zha.application.helpers import CoordinatorConfiguration, ZHAConfiguration, ZHAData
from zha.const import STATE_CHANGED

from lookout.args import args
from lookout.dbus import cloak

# basic error logging to see zigpy and ZHA internals if the radio fails
# or if a device misbehaves.
logging.basicConfig(level=logging.INFO)
if not args.verbose:
    logging.getLogger("zha").setLevel(logging.WARNING)
    logging.getLogger("zigpy").setLevel(logging.WARNING)
    logging.getLogger("bellows").setLevel(logging.WARNING)
logger = logging.getLogger("lookout")


async def pair_once(gateway: Gateway):
    signal = asyncio.get_running_loop().create_future()

    # allow joining for n seconds
    # once the sensor is paired, it gets written to the db
    await gateway.application_controller.permit(args.pair)
    logger.info(f"Permit join enabled for {args.pair} seconds. Pair your sensor now.")

    # listen for new devices joining at runtime and wait for ZHA to emit the FULL_INIT event
    def device_joined_listener(event):
        if not signal.done() and (
            device := gateway.devices.get(event.device_info.ieee)
        ):
            logger.info(
                f"Paired device: '{device.name}' ({device.ieee}) | Model: '{device.model}'."
            )
            signal.set_result(None)

    unsubscribe = gateway.on_event(ZHA_GW_MSG_DEVICE_FULL_INIT, device_joined_listener)
    try:
        async with asyncio.timeout(args.pair):
            await signal
    except asyncio.TimeoutError:
        logger.warning(f"No new device joined within {args.pair} seconds. Exiting.")
    unsubscribe()


async def subscribe(device: Device):
    logger.info(
        f"Subscribe to: '{device.name}' ({device.ieee}) | Model: '{device.model}'."
    )
    queue = asyncio.Queue[bool]()
    # door sensors must expose a BINARY_SENSOR platform entity under the hood
    for (platform, unique_id), entity in device.platform_entities.items():
        logger.info(
            f"Entity: '{platform}' ({unique_id}).",
        )
        if platform == Platform.BINARY_SENSOR:

            def state_changed_listener(event, e=entity, d=device):
                is_open = e.state.get("state")
                queue.put_nowait(bool(is_open))

            unsubscribe = entity.on_event(STATE_CHANGED, state_changed_listener)
            logger.info(f"Subscribed to door sensor: '{device.name}' ({device.ieee}).")
            try:
                while True:
                    yield await queue.get()
            finally:
                # if the async for-loop breaks or the task is cancelled, clean up the listener
                unsubscribe()


async def handler(has_open: bool):
    if (has_open and not args.only_close) or (not has_open and not args.only_open):
        logger.info(f"Action {'open' if has_open else 'close'}.")
        await cloak.hide()


async def amain():
    # configure the ZHA Gateway
    # the zigpy_config provides the database path where the paired network
    # and device states+keys are saved locally
    zha_data = ZHAData(
        config=ZHAConfiguration(
            coordinator_configuration=CoordinatorConfiguration(
                radio_type=args.radio,
                path=str(args.device),
                baudrate=args.baud,
                flow_control=args.flow_control,  # type: ignore
            )
        ),
        zigpy_config={
            "database_path": str(args.db),
        },
    )

    # Instantiate the gateway
    gateway = Gateway(config=zha_data)

    try:
        # initialize the Zigbee network
        # this connects to the coordinator and loads paired devices from the database
        logger.info("Initializing ZHA gateway...")
        await gateway.async_initialize()

        if args.pair:
            await pair_once(gateway)
            return

        # subscribe to already paired devices from the database
        def build_streams():
            for ieee, device in gateway.devices.items():
                logger.info(
                    f"Found paired device: '{device.name}' ({ieee}) | Model: '{device.model}'"
                    + ("" if device.model == args.model else " - skipped")
                    + "."
                )
                if device.model == args.model:
                    yield subscribe(device)

        logger.info("Listening for door events... Press Ctrl+C to exit.")
        async with aiostream.stream.merge(*build_streams()).stream() as streamer:
            async for event in streamer:
                await handler(event)

    finally:
        logger.info("Exiting...")
        os._exit(1)
    # zha+bellows teardown is currently broken
    # except Exception:
    #     await gateway.shutdown()
    #     pass


def main():
    asyncio.run(amain())


if __name__ == "__main__":
    main()
