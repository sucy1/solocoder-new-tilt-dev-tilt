package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/tilt-dev/tilt/internal/analytics"
	engineanalytics "github.com/tilt-dev/tilt/internal/engine/analytics"
	"github.com/tilt-dev/tilt/pkg/model"
)

const DisableStateFile = ".tilt-disable.json"

type DisableState struct {
	DisabledResources []string `json:"disabled_resources"`
	UpdatedAt         string   `json:"updated_at"`
}

func loadDisableState() (*DisableState, error) {
	data, err := os.ReadFile(DisableStateFile)
	if err != nil {
		if os.IsNotExist(err) {
			return &DisableState{DisabledResources: []string{}}, nil
		}
		return nil, errors.Wrap(err, "reading disable state file")
	}

	var state DisableState
	err = json.Unmarshal(data, &state)
	if err != nil {
		return nil, errors.Wrap(err, "parsing disable state file")
	}
	return &state, nil
}

func saveDisableState(state *DisableState) error {
	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return errors.Wrap(err, "marshaling disable state")
	}
	err = os.WriteFile(DisableStateFile, data, 0644)
	if err != nil {
		return errors.Wrap(err, "writing disable state file")
	}
	return nil
}

func persistDisableState(ctx context.Context, resources []string, disabled bool) error {
	state, err := loadDisableState()
	if err != nil {
		return err
	}

	resourceSet := make(map[string]bool)
	for _, r := range state.DisabledResources {
		resourceSet[r] = true
	}

	for _, r := range resources {
		if disabled {
			resourceSet[r] = true
		} else {
			delete(resourceSet, r)
		}
	}

	state.DisabledResources = make([]string, 0, len(resourceSet))
	for r := range resourceSet {
		state.DisabledResources = append(state.DisabledResources, r)
	}

	return saveDisableState(state)
}

type disableCmd struct {
	all    bool
	labels []string
	load   bool
	show   bool
}

func newDisableCmd() *disableCmd {
	return &disableCmd{}
}

func (c *disableCmd) name() model.TiltSubcommand { return "disable" }

func (c *disableCmd) register() *cobra.Command {
	cmd := &cobra.Command{
		Use:                   "disable {-all | <resource>... | --load | --show}",
		DisableFlagsInUseLine: true,
		Short:                 "Disables resources",
		Long: `Disables the specified resources in Tilt.

# disables the resources named 'frontend' and 'backend'
tilt disable frontend backend

# disables all resources
tilt disable --all

# loads and applies the disable state from .tilt-disable.json
tilt disable --load

# shows the current saved disable state
tilt disable --show`,
	}

	cmd.Flags().StringSliceVarP(&c.labels, "labels", "l", c.labels, "Disable all resources with the specified labels")
	cmd.Flags().BoolVar(&c.all, "all", false, "Disable all resources")
	cmd.Flags().BoolVar(&c.load, "load", false, "Load and apply disable state from .tilt-disable.json")
	cmd.Flags().BoolVar(&c.show, "show", false, "Show the current saved disable state from .tilt-disable.json")

	addConnectServerFlags(cmd)

	return cmd
}

func (c *disableCmd) run(ctx context.Context, args []string) error {
	if c.show {
		return showDisableState(ctx)
	}

	ctrlclient, err := newClient(ctx)
	if err != nil {
		return err
	}

	if c.load {
		return loadAndApplyDisableState(ctx, ctrlclient)
	}

	if c.all {
		if len(args) > 0 {
			return errors.New("cannot use --all with resource names")
		}
	} else if len(args) == 0 && len(c.labels) == 0 {
		return errors.New("must specify at least one resource")
	}

	a := analytics.Get(ctx)
	cmdTags := engineanalytics.CmdTags(map[string]string{})
	cmdTags["all"] = strconv.FormatBool(c.all)
	a.Incr("cmd.disable", cmdTags.AsMap())
	defer a.Flush(time.Second)

	affected, err := changeEnabledResources(ctx, ctrlclient, args, enableOptions{enable: false, all: c.all, only: false, labels: c.labels})
	if err != nil {
		return err
	}

	err = persistDisableState(ctx, affected, true)
	if err != nil {
		return errors.Wrap(err, "persisting disable state")
	}

	return nil
}

func showDisableState(ctx context.Context) error {
	state, err := loadDisableState()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return errors.Wrap(err, "marshaling disable state")
	}

	fmt.Println(string(data))
	return nil
}

func loadAndApplyDisableState(ctx context.Context, ctrlclient client.Client) error {
	state, err := loadDisableState()
	if err != nil {
		return err
	}

	if len(state.DisabledResources) == 0 {
		fmt.Println("No disabled resources in saved state")
		return nil
	}

	fmt.Printf("Loading disable state for %d resources: %s\n", len(state.DisabledResources), strings.Join(state.DisabledResources, ", "))

	_, err = changeEnabledResources(ctx, ctrlclient, state.DisabledResources, enableOptions{enable: false, all: false, only: false, labels: nil})
	if err != nil {
		return errors.Wrap(err, "applying disable state")
	}

	fmt.Println("Disable state applied successfully")
	return nil
}
